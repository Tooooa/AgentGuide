"""
Lightweight proxy server that:
- injects JSON scoring instructions into prompts,
- forwards to DeepSeek (or compatible OpenAI-style API),
- parses self-reported probabilities, runs watermark sampling, and decodes bits.

Usage:
    export DEEPSEEK_API_KEY=sk-xxx
    # optional: TARGET_LLM_BASE=https://api.deepseek.com
    # optional: HOST/PORT for this proxy
    uvicorn agentmark.proxy.server:app --host 0.0.0.0 --port 8000

Client side (minimal change):
    export OPENAI_BASE_URL=http://localhost:8000/v1   # 或直接替换调用地址
    export OPENAI_API_KEY=<对方原有 key>              # 我们不使用，但保持兼容

POST /v1/chat/completions 兼容 OpenAI 风格请求：
    {
      "model": "...",
      "messages": [...],
      "temperature": 0.2,
      "max_tokens": 300,
      "candidates": ["A","B","C"],   # 可选，显式提供候选
      "context": "task||step1"       # 可选，水印解码用
    }

响应：
    原始 LLM 响应字段 + watermark 字段（包含 action/action_args/probabilities_used/frontend_data/decoded_bits）。
    原始 content 不做修改，方便向后兼容；消费者可读取 watermark 部分。
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from collections import OrderedDict
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from openai import OpenAI

from agentmark.sdk import AgentWatermarker, PromptWatermarkWrapper, get_prompt_instruction
from agentmark.sdk.prompt_adapter import extract_json_payload

DEFAULT_CONTEXT = "proxy||step1"

DEFAULT_TARGET_BASE = "https://api.deepseek.com"
DEFAULT_MODEL_MAP = {
    "gpt-4o": "deepseek-chat",
    "gpt-4o-mini": "deepseek-chat",
    "gpt-4-turbo": "deepseek-chat",
    "gpt-4": "deepseek-chat",
    "gpt-3.5-turbo": "deepseek-chat",
}
DEFAULT_SESSION_KEY = "default"
DEFAULT_MAX_SESSIONS = 128


class Message(BaseModel):
    role: str
    content: Optional[str] = None
    tool_call_id: Optional[str] = None


def _message_to_dict(message: Message) -> Dict[str, Any]:
    return message.model_dump(exclude_none=True)


class CompletionRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float] = 0.2
    max_tokens: Optional[int] = 300
    candidates: Optional[List[str]] = None  # direct candidate list (preferred)
    tools: Optional[List[Any]] = None       # OpenAI style tools/functions
    extra_body: Optional[Dict[str, Any]] = None  # misc custom fields
    context: Optional[str] = DEFAULT_CONTEXT


app = FastAPI()
logger = logging.getLogger("agentmark.proxy")
_SESSION_CACHE: "OrderedDict[str, AgentWatermarker]" = OrderedDict()


def _debug_enabled() -> bool:
    return (os.getenv("AGENTMARK_DEBUG") or "").strip().lower() in {"1", "true", "yes", "on"}


def _debug_print(label: str, payload: Any) -> None:
    if _debug_enabled():
        print(f"[agentmark:{label}] {json.dumps(payload, ensure_ascii=False, default=str)}")


def _extract_system_prompt_text(messages: List[Message]) -> str:
    for msg in messages:
        if msg.role == "system":
            return msg.content or ""
    return ""


def _render_messages(messages: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content")
        if content is None:
            continue
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _sanitize_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "tool" and not msg.get("tool_call_id"):
            # Avoid invalid tool messages breaking downstream APIs.
            continue
        cleaned.append(msg)
    return cleaned


def _get_session_key(
    req: CompletionRequest, system_agentmark: Dict[str, Any], request: Request
) -> str:
    header_key = request.headers.get("x-agentmark-session") or request.headers.get("x-session-id")
    if header_key:
        return header_key.strip()
    eb = req.extra_body or {}
    agentmark_cfg = eb.get("agentmark") or {}
    for candidate in (
        agentmark_cfg.get("session_id"),
        agentmark_cfg.get("conversation_id"),
        eb.get("session_id"),
        eb.get("conversation_id"),
        system_agentmark.get("session_id"),
        system_agentmark.get("conversation_id"),
    ):
        if candidate:
            return str(candidate)
    if req.context and req.context != DEFAULT_CONTEXT:
        return str(req.context)
    return os.getenv("AGENTMARK_SESSION_DEFAULT", DEFAULT_SESSION_KEY)


def _get_watermarker(session_key: str) -> AgentWatermarker:
    if session_key in _SESSION_CACHE:
        _SESSION_CACHE.move_to_end(session_key)
        return _SESSION_CACHE[session_key]

    payload_bits = os.getenv("AGENTMARK_PAYLOAD_BITS")
    payload_text = os.getenv("AGENTMARK_PAYLOAD_TEXT")
    if payload_bits and payload_text:
        payload_text = None
    wm = AgentWatermarker(payload_bits=payload_bits, payload_text=payload_text)
    _SESSION_CACHE[session_key] = wm

    max_sessions = int(os.getenv("AGENTMARK_MAX_SESSIONS", str(DEFAULT_MAX_SESSIONS)))
    while len(_SESSION_CACHE) > max_sessions:
        _SESSION_CACHE.popitem(last=False)
    return wm


def _inject_prompt(
    messages: List[Message],
    instr: str,
    candidates: Optional[List[str]],
    mode: str,
    tools: Optional[List[Any]] = None,
) -> List[dict]:
    # Add a dedicated system message for AgentMark instruction at the FRONT to avoid clobbering user prompt
    msgs = [{"role": "system", "content": instr}]
    msgs.extend([_message_to_dict(m) for m in messages])

    if candidates:
        user_lines = "候选动作：\n" + "\n".join(f"- {c}" for c in candidates)
        tool_lines = ""
        if tools:
            tool_specs = []
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function", {}) if isinstance(tool.get("function"), dict) else tool
                name = fn.get("name") or tool.get("name")
                params = fn.get("parameters", {}) or {}
                props = params.get("properties", {}) if isinstance(params, dict) else {}
                if name:
                    if props:
                        keys = ", ".join(props.keys())
                        tool_specs.append(f"- {name}({keys})")
                    else:
                        tool_specs.append(f"- {name}(...)")
            if tool_specs:
                tool_lines = "\n可用工具参数：\n" + "\n".join(tool_specs)
        # Append to last user message, or add new user message if none
        for m in reversed(msgs):
            if m["role"] == "user":
                m["content"] = (m["content"] or "") + "\n" + user_lines + tool_lines
                break
        else:
            msgs.append({"role": "user", "content": user_lines + tool_lines})
    else:
        # Bootstrap mode: ask LLM to propose candidates + probabilities
        bootstrap_note = (
            "未提供候选动作，请先生成一组合理的候选动作，并在 action_weights 中给出每个候选的概率。"
            "候选应为短语/动作名称，数量适中（3-8个）。"
        )
        msgs[0]["content"] += "\n" + bootstrap_note
    # Record mode inside first system for transparency
    msgs[0]["content"] += f"\n[AgentMark mode={mode}]"
    return msgs


def _llm_client():
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not set.")
    base_url = os.getenv("TARGET_LLM_BASE", DEFAULT_TARGET_BASE)
    return OpenAI(api_key=api_key, base_url=base_url)


def _resolve_model(requested_model: str) -> str:
    override = os.getenv("TARGET_LLM_MODEL")
    if override:
        return override
    model_map_env = os.getenv("TARGET_LLM_MODEL_MAP")
    if model_map_env:
        try:
            model_map = json.loads(model_map_env)
            return model_map.get(requested_model, requested_model)
        except json.JSONDecodeError:
            pass
    return DEFAULT_MODEL_MAP.get(requested_model, requested_model)


def _tool_mode(req: CompletionRequest) -> str:
    mode_env = (os.getenv("AGENTMARK_TOOL_MODE") or "").strip().lower()
    if mode_env in {"proxy", "two_pass", "none"}:
        return mode_env
    two_pass_env = (os.getenv("AGENTMARK_TWO_PASS") or "").strip().lower()
    if two_pass_env in ("1", "true", "yes", "on"):
        return "two_pass"
    if two_pass_env in ("0", "false", "no", "off"):
        return "proxy"
    return "proxy" if req.tools else "none"


def _build_tool_calls(action: str, action_args: Any) -> List[Dict[str, Any]]:
    if not action:
        return []
    args = action_args if isinstance(action_args, dict) else {}
    return [
        {
            "id": f"call_agentmark_{uuid.uuid4().hex[:8]}",
            "type": "function",
            "function": {"name": action, "arguments": json.dumps(args)},
        }
    ]


def _build_tool_calls(action: str, action_args: Any) -> List[Dict[str, Any]]:
    if not action:
        return []
    args = action_args if isinstance(action_args, dict) else {}
    return [
        {
            "id": f"call_agentmark_{uuid.uuid4().hex[:8]}",
            "type": "function",
            "function": {"name": action, "arguments": json.dumps(args)},
        }
    ]


def _normalize_candidates(cands: List[str]) -> List[str]:
    seen = set()
    normed = []
    for c in cands:
        name = str(c).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        normed.append(name)
    return normed


def _coerce_candidates(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        if "candidates" in raw:
            return _coerce_candidates(raw.get("candidates"))
        return [str(k) for k in raw.keys()]
    if isinstance(raw, (list, tuple)):
        out: List[str] = []
        for item in raw:
            if isinstance(item, dict):
                name = item.get("function", {}).get("name") or item.get("name")
                if name:
                    out.append(str(name))
            else:
                out.append(str(item))
        return out
    return [str(raw)]


def _placeholder_for_schema(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return ""
    dtype = schema.get("type")
    if dtype == "string":
        return ""
    if dtype in ("number", "integer"):
        return 0
    if dtype == "boolean":
        return False
    if dtype == "array":
        return []
    if dtype == "object":
        return {}
    return None


def _build_action_args_map(
    payload: Dict[str, Any],
    candidates: List[str],
    tools: Optional[List[Any]],
) -> Dict[str, Any]:
    action_args_map: Dict[str, Any] = {}
    if isinstance(payload, dict):
        raw_args = payload.get("action_args") or payload.get("args") or {}
        if isinstance(raw_args, dict):
            action_args_map.update(raw_args)

    tool_schema: Dict[str, Dict[str, Any]] = {}
    if tools:
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            fn = tool.get("function", {}) if isinstance(tool.get("function"), dict) else tool
            name = fn.get("name") or tool.get("name")
            params = fn.get("parameters", {}) if isinstance(fn, dict) else {}
            props = params.get("properties", {}) if isinstance(params, dict) else {}
            if name and isinstance(props, dict):
                tool_schema[name] = props

    for name in candidates:
        args = action_args_map.get(name)
        if isinstance(args, dict) and args:
            continue
        props = tool_schema.get(name, {})
        placeholder_args: Dict[str, Any] = {}
        for key, schema in props.items():
            placeholder_args[key] = _placeholder_for_schema(schema)
        action_args_map[name] = placeholder_args if placeholder_args else (args if isinstance(args, dict) else {})

    return action_args_map


def _extract_agentmark_from_system(messages: List[Message]) -> Dict[str, Any]:
    for msg in reversed(messages):
        if msg.role != "system":
            continue
        payload = extract_json_payload(msg.content or "")
        if not isinstance(payload, dict):
            continue
        agentmark_cfg = payload.get("agentmark")
        if isinstance(agentmark_cfg, dict):
            return agentmark_cfg
    return {}


def _extract_candidates(req: CompletionRequest, system_agentmark: Dict[str, Any]) -> Tuple[List[str], str]:
    """
    Candidate extraction priority:
    1) tools/functions (OpenAI format)
    2) system message with agentmark metadata
    3) extra_body.agentmark.candidates or top-level candidates
    4) prompt extraction (not implemented here)
    5) bootstrap (LLM self-propose)
    """
    # 1) tools/functions
    candidates: List[str] = []
    mode = "bootstrap"
    if req.tools:
        for tool in req.tools:
            if isinstance(tool, dict):
                name = tool.get("function", {}).get("name") or tool.get("name")
                if name:
                    candidates.append(name)
    if candidates:
        mode = "tools"
        return _normalize_candidates(candidates), mode

    # 2) system agentmark metadata
    sys_candidates = _coerce_candidates(system_agentmark.get("candidates"))
    if sys_candidates:
        mode = "system"
        return _normalize_candidates(sys_candidates), mode

    # 3) extra_body.agentmark.candidates or top-level candidates
    eb = req.extra_body or {}
    agentmark_cfg = eb.get("agentmark") or {}
    eb_candidates = _coerce_candidates(
        agentmark_cfg.get("candidates") or eb.get("candidates") or req.candidates
    )
    if eb_candidates:
        mode = "extra_body"
        return _normalize_candidates(list(eb_candidates)), mode

    # 4) prompt extraction could be added here (regex), skipped for now
    return [], mode


def _extract_context(
    req: CompletionRequest,
    system_agentmark: Dict[str, Any],
    session_key: str,
    round_num: int,
) -> str:
    if req.context and req.context != DEFAULT_CONTEXT:
        return str(req.context)
    eb = req.extra_body or {}
    agentmark_cfg = eb.get("agentmark") or {}
    for candidate in (agentmark_cfg.get("context"), eb.get("context"), system_agentmark.get("context")):
        if candidate:
            return str(candidate)
    return f"{session_key}||step{round_num}"


@app.post("/v1/chat/completions")
def proxy_completion(req: CompletionRequest, request: Request):
    try:
        instr = get_prompt_instruction()
        system_agentmark = _extract_agentmark_from_system(req.messages)
        candidates, mode = _extract_candidates(req, system_agentmark)
        session_key = _get_session_key(req, system_agentmark, request)
        wm = _get_watermarker(session_key)
        round_used = wm.current_round
        context_used = _extract_context(req, system_agentmark, session_key, round_used)
        rewritten = _inject_prompt(
            req.messages,
            instr,
            candidates if candidates else None,
            mode,
            tools=req.tools,
        )
        rewritten = _sanitize_messages(rewritten)
        _debug_print(
            "inbound_request",
            {
                "model": req.model,
                "messages": [_message_to_dict(m) for m in req.messages],
                "tools": req.tools,
                "extra_body": req.extra_body,
                "context": req.context,
                "candidates": req.candidates,
            },
        )
        _debug_print("system_prompt", {"content": _extract_system_prompt_text(req.messages)})
        _debug_print(
            "scoring_request",
            {
                "model": req.model,
                "messages": rewritten,
                "mode": mode,
                "candidates": candidates,
                "context_used": context_used,
                "round_num": round_used,
            },
        )

        client = _llm_client()
        target_model = _resolve_model(req.model)
        scoring_resp = client.chat.completions.create(
            model=target_model,
            messages=rewritten,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        raw_text = scoring_resp.choices[0].message.content
        _debug_print("llm_raw_output", {"raw_text": raw_text})

        wrapper = PromptWatermarkWrapper(wm)

        try:
            result = wrapper.process(
                raw_output=raw_text,
                fallback_actions=candidates if candidates else None,
                context=context_used,
                history=[m.content for m in req.messages if m.role == "user"],
                round_num=round_used,
            )
        except Exception as e:
            logger.exception("watermark processing failed")
            raise HTTPException(status_code=500, detail=f"watermark processing failed: {e}")

        action_args_map = _build_action_args_map(
            result.get("raw_payload") or {},
            candidates,
            req.tools,
        )
        if action_args_map:
            if not isinstance(result.get("action_args"), dict):
                result["action_args"] = action_args_map.get(result["action"], {})

        round_used = result["frontend_data"]["watermark_meta"]["round_num"]
        decoded_bits = wm.decode(
            probabilities=result["probabilities_used"],
            selected_action=result["action"],
            context=context_used,
            round_num=round_used,
        )

        final_resp = scoring_resp
        tool_mode = _tool_mode(req)
        execution_messages: Optional[List[Dict[str, Any]]] = None
        if tool_mode == "two_pass":
            base_messages = _sanitize_messages([_message_to_dict(m) for m in req.messages])
            tool_choice = None
            if req.tools and result["action"] in candidates:
                tool_choice = {"type": "function", "function": {"name": result["action"]}}
            _debug_print(
                "tool_request",
                {
                    "model": target_model,
                    "messages": base_messages,
                    "tools": req.tools,
                    "tool_choice": tool_choice,
                    "round_num": round_used,
                    "session_id": session_key,
                },
            )
            execution_messages = base_messages
            final_resp = client.chat.completions.create(
                model=target_model,
                messages=base_messages,
                tools=req.tools,
                tool_choice=tool_choice,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            )

        # Build response: keep original structure, append watermark info
        resp_dict = final_resp.model_dump()
        if tool_mode == "proxy" and req.tools:
            tool_calls = _build_tool_calls(result["action"], result["action_args"])
            if resp_dict.get("choices"):
                resp_dict["choices"][0]["message"]["tool_calls"] = tool_calls
                resp_dict["choices"][0]["finish_reason"] = "tool_calls"
                resp_dict["choices"][0]["message"]["content"] = None
            _debug_print(
                "tool_calls_proxy",
                {
                    "tool_calls": tool_calls,
                    "arguments_obj": result["action_args"],
                    "selected_probability": result["probabilities_used"].get(result["action"]),
                },
            )
        resp_dict["watermark"] = {
            "action": result["action"],
            "action_args": result["action_args"],
            "action_args_full": action_args_map,
            "probabilities_used": result["probabilities_used"],
            "selected_probability": result["probabilities_used"].get(result["action"]),
            "frontend_data": result["frontend_data"],
            "decoded_bits": decoded_bits,
            "candidates_used": candidates,
            "session_id": session_key,
            "context_used": result["frontend_data"]["watermark_meta"].get("context"),
            "round_num": round_used,
            "mode": (mode if candidates else "bootstrap") + f"_{tool_mode}",
            "raw_llm_output": raw_text,
            "prompt_trace": {
                "scoring_messages": rewritten,
                "scoring_prompt_text": _render_messages(rewritten),
                "execution_messages": execution_messages,
                "execution_prompt_text": _render_messages(execution_messages)
                if execution_messages
                else None,
            },
        }
        logger.info("watermark=%s", resp_dict["watermark"])
        print(f"[watermark] {json.dumps(resp_dict['watermark'], ensure_ascii=False, default=str)}")
        return resp_dict
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("proxy_completion failed")
        raise HTTPException(status_code=500, detail=str(e))
