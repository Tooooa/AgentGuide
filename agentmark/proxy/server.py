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
    content: str


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
        print(f"[agentmark:{label}] {json.dumps(payload, ensure_ascii=False)}")


def _extract_system_prompt_text(messages: List[Message]) -> str:
    for msg in messages:
        if msg.role == "system":
            return msg.content or ""
    return ""


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


def _inject_prompt(messages: List[Message], instr: str, candidates: Optional[List[str]], mode: str) -> List[dict]:
    # Add a dedicated system message for AgentMark instruction at the FRONT to avoid clobbering user prompt
    msgs = [{"role": "system", "content": instr}]
    msgs.extend([m.dict() for m in messages])

    if candidates:
        user_lines = "候选动作：\n" + "\n".join(f"- {c}" for c in candidates)
        # Append to last user message, or add new user message if none
        for m in reversed(msgs):
            if m["role"] == "user":
                m["content"] = (m["content"] or "") + "\n" + user_lines
                break
        else:
            msgs.append({"role": "user", "content": user_lines})
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


def _should_two_pass(req: CompletionRequest) -> bool:
    mode = (os.getenv("AGENTMARK_TWO_PASS") or "auto").strip().lower()
    if mode in ("1", "true", "yes", "on"):
        return True
    if mode in ("0", "false", "no", "off"):
        return False
    return bool(req.tools)


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
        rewritten = _inject_prompt(req.messages, instr, candidates if candidates else None, mode)
        _debug_print(
            "inbound_request",
            {
                "model": req.model,
                "messages": [m.dict() for m in req.messages],
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
            raise HTTPException(status_code=500, detail=f"watermark processing failed: {e}")

        round_used = result["frontend_data"]["watermark_meta"]["round_num"]
        decoded_bits = wm.decode(
            probabilities=result["probabilities_used"],
            selected_action=result["action"],
            context=context_used,
            round_num=round_used,
        )

        # Two-pass: for tool-using agents, re-call LLM to emit tool_calls
        final_resp = scoring_resp
        two_pass = _should_two_pass(req)
        if two_pass:
            base_messages = [m.dict() for m in req.messages]
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
        resp_dict["watermark"] = {
            "action": result["action"],
            "action_args": result["action_args"],
            "probabilities_used": result["probabilities_used"],
            "frontend_data": result["frontend_data"],
            "decoded_bits": decoded_bits,
            "candidates_used": candidates,
            "session_id": session_key,
            "context_used": result["frontend_data"]["watermark_meta"].get("context"),
            "round_num": round_used,
            "mode": (mode if candidates else "bootstrap") + ("_two_pass" if two_pass else ""),
            "raw_llm_output": raw_text,
        }
        logger.info("watermark=%s", resp_dict["watermark"])
        print(f"[watermark] {json.dumps(resp_dict['watermark'])}")
        return resp_dict
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
