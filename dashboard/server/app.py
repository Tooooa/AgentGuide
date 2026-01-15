
import json
import re
import uuid
import time
import os
import asyncio
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI, AsyncOpenAI
from sentence_transformers import SentenceTransformer, util
import copy
# --- Configuration ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SWARM_ROOT = PROJECT_ROOT / "swarm"
TOOL_DATA_ROOT = PROJECT_ROOT / "experiments/toolbench/data/data/toolenv/tools"

import sys
sys.path.append(str(PROJECT_ROOT))
if SWARM_ROOT.exists():
    sys.path.append(str(SWARM_ROOT))

from agentmark.core.rlnc_codec import DeterministicRLNC
from agentmark.core.watermark_sampler import sample_behavior_differential
from agentmark.sdk.prompt_adapter import extract_json_payload, get_prompt_instruction

# --- Database Setup ---
from dashboard.server.database import ConversationDB
db = ConversationDB(db_path=str(PROJECT_ROOT / "dashboard/data/conversations.db"))

# --- Retriever Setup ---
from dashboard.server.retriever import ToolBenchRetriever
# from retriever import ToolBenchRetriever # If running from server dir? 
# Better use relative or absolute if path is set.
# Since app.py is in dashboard/server, 'import retriever' works if CWD is dashboard/server OR if dashboard/server is in path.
# But we run from root usually.
# If we run `python dashboard/server/app.py`, sys.path[0] is dashboard/server. So `import retriever` works.
# But `agentmark` needs root in path.

from agentmark.environments.toolbench.adapter import ToolBenchAdapter
retriever = None
retriever_loading = False

async def init_retriever():
    global retriever, retriever_loading
    retriever_loading = True
    print("[INFO] Background: Initializing ToolBench Retriever on CPU...")
    try:
        # Run in thread to avoid blocking simple init
        r = await asyncio.to_thread(ToolBenchRetriever, TOOL_DATA_ROOT, device="cpu")
        await asyncio.to_thread(r.load_model)
        await asyncio.to_thread(r.index_tools)
        retriever = r
        print("[INFO] Background: Retriever Ready.")
    except Exception as e:
        print(f"[ERROR] Background Retriever Init Failed: {e}")
    finally:
        retriever_loading = False

# --- App Setup ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    print("[INFO] Initializing ToolBench Retriever...")
    asyncio.create_task(init_retriever())


# --- Simulation State ---

class AgentState:
    """Encapsulates the state for a single agent (Baseline or Watermarked)"""
    def __init__(self, task_data: Dict, role: str):
        self.role = role # 'baseline' or 'watermarked'
        self.task = copy.deepcopy(task_data) # Deep copy to ensure independent modification
        
        # ToolBench Adapter State
        # For this demo, we use a simplified Adapter relying on LLM to propose JSON
        self.adapter = ToolBenchAdapter(TOOL_DATA_ROOT)
        self.episode = self.adapter.prepare_episode(self.task)
        
        # Execution History
        self.trajectory = [] # List of {role, message}
        self.swarm_history: List[Dict[str, Any]] = []
        self.step_count = 0
        self.last_observation = ""
        self.done = False

class Session:
    def __init__(self, session_id: str, api_key: str, task_data: Dict, payload: str = "1101"):
        self.session_id = session_id
        self.start_time = time.time()
        
        # Common Config
        self.max_steps = 15
        
        # Agent States
        self.watermarked_state = AgentState(task_data, 'watermarked')
        self.baseline_state = AgentState(task_data, 'baseline')
        
        # Payload / Watermark State (Only for watermarked agent)
        self.bit_stream_str_raw = payload if payload else "1101" # Keep raw for reference
        # Initialize RLNC
        self.rlnc = DeterministicRLNC(self.bit_stream_str_raw)
        self.bit_index = 0
        
        # LLM Client
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
        self.async_client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
        self.model = "deepseek-chat"
        self.evaluation_result = None # Store evaluation result

sessions: Dict[str, Session] = {}

# --- Swarm Plugin Mode ---

def get_weather(location: str, time: str = "now") -> str:
    """Get the current weather in a given location. Location MUST be a city."""
    return json.dumps({"location": location, "temperature": "65", "time": time})


def get_weather_forecast(location: str, days: str = "3") -> str:
    """Get a short weather forecast for a given location and number of days."""
    try:
        days_val = int(days)
    except Exception:
        days_val = 3
    return json.dumps(
        {"location": location, "days": days_val, "forecast": ["sunny", "cloudy", "rain"]}
    )


def get_air_quality(location: str) -> str:
    """Get a simple air quality report for a given location."""
    return json.dumps({"location": location, "aqi": 42, "status": "good"})


def send_email(recipient: str, subject: str, body: str) -> str:
    """Send a short email."""
    print("Sending email...")
    print(f"To: {recipient}")
    print(f"Subject: {subject}")
    print(f"Body: {body}")
    return "Sent!"


def send_sms(phone_number: str, message: str) -> str:
    """Send a short SMS message to a phone number."""
    print("Sending sms...")
    print(f"To: {phone_number}")
    print(f"Message: {message}")
    return "Sent!"

def get_top_rated_movies(limit: int = 10, min_imdb: float = 8.0) -> str:
    """Return a list of top-rated movies with IMDb scores."""
    return json.dumps(
        {
            "limit": limit,
            "min_imdb": min_imdb,
            "results": [
                {"title": "The Shawshank Redemption", "imdb": 9.3},
                {"title": "The Godfather", "imdb": 9.2},
                {"title": "The Dark Knight", "imdb": 9.0},
            ],
        }
    )


def search_movies_by_genre(genre: str, limit: int = 10) -> str:
    """Search movies by genre."""
    return json.dumps(
        {
            "genre": genre,
            "limit": limit,
            "results": ["Inception", "Interstellar", "The Matrix"],
        }
    )


def get_movie_summary(title: str) -> str:
    """Fetch a short summary for a movie title."""
    return json.dumps(
        {
            "title": title,
            "summary": "A brief synopsis for the requested movie.",
        }
    )


def search_web(query: str) -> str:
    """Search the web for general queries."""
    return json.dumps({"query": query, "results": []})


ADD_AGENT_SYSTEM_PROMPT = "You are a helpful agent."
TOOLBENCH_SWARM_PROMPT = (
    "You are a tool-using agent. Use the provided tools to solve the task. "
    "Call a tool when needed; otherwise, respond with the final answer."
)

ADD_AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location. Location MUST be a city.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}, "time": {"type": "string"}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather_forecast",
            "description": "Get a short weather forecast for a given location and number of days.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}, "days": {"type": "string"}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_air_quality",
            "description": "Get a simple air quality report for a given location.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "",
            "parameters": {
                "type": "object",
                "properties": {
                    "recipient": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["recipient", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_sms",
            "description": "Send a short SMS message to a phone number.",
            "parameters": {
                "type": "object",
                "properties": {"phone_number": {"type": "string"}, "message": {"type": "string"}},
                "required": ["phone_number", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_rated_movies",
            "description": "Return a list of top-rated movies with IMDb scores.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer"},
                    "min_imdb": {"type": "number"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_movies_by_genre",
            "description": "Search movies by genre.",
            "parameters": {
                "type": "object",
                "properties": {
                    "genre": {"type": "string"},
                    "limit": {"type": "integer"},
                },
                "required": ["genre"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_movie_summary",
            "description": "Fetch a short summary for a movie title.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for general queries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            },
        },
    },
]

_SWARM_ADD_AGENT = None
_SWARM_TOOLBENCH_AGENT = None


def _get_swarm_add_agent():
    global _SWARM_ADD_AGENT
    if _SWARM_ADD_AGENT is None:
        from swarm import Agent

        _SWARM_ADD_AGENT = Agent(
            name="General Tool Agent",
            instructions=ADD_AGENT_SYSTEM_PROMPT,
            functions=[
                get_weather,
                get_weather_forecast,
                get_air_quality,
                get_top_rated_movies,
                search_movies_by_genre,
                get_movie_summary,
                search_web,
                send_email,
                send_sms,
            ],
        )
    return _SWARM_ADD_AGENT


def _get_swarm_toolbench_agent():
    global _SWARM_TOOLBENCH_AGENT
    if _SWARM_TOOLBENCH_AGENT is None:
        from swarm import Agent

        _SWARM_TOOLBENCH_AGENT = Agent(
            name="ToolBench Agent",
            instructions=TOOLBENCH_SWARM_PROMPT,
        )
    return _SWARM_TOOLBENCH_AGENT


def _toolbench_param_to_schema(param: Any) -> Optional[Dict[str, Any]]:
    if isinstance(param, dict):
        name = param.get("name") or param.get("parameter") or param.get("field")
        if not name:
            return None
        param_type = (param.get("type") or param.get("param_type") or "string").lower()
        description = (param.get("description") or param.get("desc") or "").strip()
    elif isinstance(param, str):
        name = param
        param_type = "string"
        description = ""
    else:
        return None

    if param_type not in {"string", "number", "integer", "boolean", "object", "array"}:
        param_type = "string"

    schema = {"name": name, "type": param_type}
    if description:
        schema["description"] = description
    return schema


def _build_toolbench_tools(tool_summaries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tools: List[Dict[str, Any]] = []
    for tool in tool_summaries:
        if not isinstance(tool, dict):
            continue
        name = tool.get("name") or ""
        if not name:
            continue
        description = (tool.get("description") or "").strip()
        required_items = tool.get("required_parameters") or []
        optional_items = tool.get("optional_parameters") or []

        properties: Dict[str, Any] = {}
        required: List[str] = []

        for item in required_items:
            schema = _toolbench_param_to_schema(item)
            if not schema:
                continue
            properties[schema["name"]] = {k: v for k, v in schema.items() if k != "name"}
            required.append(schema["name"])

        for item in optional_items:
            schema = _toolbench_param_to_schema(item)
            if not schema:
                continue
            if schema["name"] in properties:
                continue
            properties[schema["name"]] = {k: v for k, v in schema.items() if k != "name"}

        parameters: Dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            parameters["required"] = required

        tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            }
        )
    return tools


def _get_add_agent_candidates() -> List[str]:
    candidates: List[str] = []
    for tool in ADD_AGENT_TOOLS:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function", {})
        if not isinstance(fn, dict):
            continue
        name = fn.get("name")
        if name and name not in candidates:
            candidates.append(name)
    return candidates


def _build_add_agent_scoring_messages(user_message: str) -> List[Dict[str, str]]:
    instr = get_prompt_instruction()
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": ADD_AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_message.strip()},
    ]

    candidates = _get_add_agent_candidates()
    if candidates:
        user_lines = "候选动作：\n" + "\n".join(f"- {c}" for c in candidates)
        tool_lines = ""
        tool_specs = []
        for tool in ADD_AGENT_TOOLS:
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
        for msg in reversed(messages):
            if msg["role"] == "user":
                msg["content"] = (msg["content"] or "") + "\n" + user_lines + tool_lines
                break
        else:
            messages.append({"role": "user", "content": user_lines + tool_lines})

    injected = [{"role": "system", "content": instr}]
    injected.extend(messages)
    injected[0]["content"] += "\n[AgentMark mode=tools]"
    return injected


def _render_prompt_messages(messages: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content")
        if content is None:
            continue
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


class AddAgentSession:
    def __init__(self, session_id: str, api_key: str, repo_url: str):
        self.session_id = session_id
        self.api_key = api_key
        self.repo_url = repo_url
        self.step_count = 0
        self.task_query = ""
        self.last_user_message = ""
        self.watermarked_trajectory: List[Dict[str, str]] = []
        self.baseline_trajectory: List[Dict[str, str]] = []
        self.model = _resolve_base_model(os.getenv("AGENTMARK_TARGET_MODEL", "gpt-4o"))
        self.async_client = AsyncOpenAI(
            api_key=api_key or os.getenv("OPENAI_API_KEY") or "anything",
            base_url=_get_base_llm_base(),
        )


add_agent_sessions: Dict[str, AddAgentSession] = {}


_PROXY_BASE_CACHE: Optional[str] = None
_BASE_LLM_BASE_CACHE: Optional[str] = None

_BASE_MODEL_MAP = {
    "gpt-4o": "deepseek-chat",
    "gpt-4o-mini": "deepseek-chat",
    "gpt-4-turbo": "deepseek-chat",
    "gpt-4": "deepseek-chat",
    "gpt-3.5-turbo": "deepseek-chat",
}


def _get_proxy_base() -> str:
    global _PROXY_BASE_CACHE
    if _PROXY_BASE_CACHE is None:
        _PROXY_BASE_CACHE = (
            os.getenv("AGENTMARK_PROXY_BASE")
            or os.getenv("OPENAI_BASE_URL")
            or "http://localhost:8001/v1"
        )
        print(f"[INFO] AgentMark proxy base: {_PROXY_BASE_CACHE}")
    return _PROXY_BASE_CACHE


def _get_base_llm_base() -> str:
    global _BASE_LLM_BASE_CACHE
    if _BASE_LLM_BASE_CACHE is None:
        _BASE_LLM_BASE_CACHE = (
            os.getenv("AGENTMARK_BASE_LLM_BASE")
            or os.getenv("TARGET_LLM_BASE")
            or "https://api.deepseek.com"
        )
        print(f"[INFO] AgentMark base LLM base: {_BASE_LLM_BASE_CACHE}")
    return _BASE_LLM_BASE_CACHE


def _resolve_base_model(requested_model: str) -> str:
    override = os.getenv("AGENTMARK_BASE_MODEL") or os.getenv("TARGET_LLM_MODEL")
    if override:
        return override
    model_map_env = os.getenv("TARGET_LLM_MODEL_MAP")
    if model_map_env:
        try:
            model_map = json.loads(model_map_env)
            return model_map.get(requested_model, requested_model)
        except json.JSONDecodeError:
            pass
    return _BASE_MODEL_MAP.get(requested_model, requested_model)


def _build_proxy_client(api_key: Optional[str]) -> OpenAI:
    return OpenAI(
        api_key=api_key or os.getenv("OPENAI_API_KEY") or "anything",
        base_url=_get_proxy_base(),
    )


def _build_base_llm_client(api_key: Optional[str]) -> OpenAI:
    return OpenAI(
        api_key=api_key or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY") or "anything",
        base_url=_get_base_llm_base(),
    )


def _extract_watermark(completion: Any) -> Optional[Dict[str, Any]]:
    try:
        extra = getattr(completion, "model_extra", None)
        if extra and isinstance(extra, dict) and extra.get("watermark"):
            return extra.get("watermark")
        extra = getattr(completion, "__pydantic_extra__", None)
        if extra and isinstance(extra, dict) and extra.get("watermark"):
            return extra.get("watermark")
        payload = completion.model_dump()
        return payload.get("watermark")
    except Exception:
        return None


def _extract_tool_calls(message: Any) -> List[Dict[str, Any]]:
    raw_tool_calls = getattr(message, "tool_calls", None)
    if not raw_tool_calls:
        return []
    tool_calls: List[Dict[str, Any]] = []
    for call in raw_tool_calls:
        if hasattr(call, "model_dump"):
            tool_calls.append(call.model_dump())
        elif isinstance(call, dict):
            tool_calls.append(call)
        else:
            tool_calls.append(getattr(call, "__dict__", {}))
    return tool_calls


def _extract_tokens_used(completion: Any) -> float:
    tokens_used = 0.0
    try:
        usage = getattr(completion, "usage", None)
        if usage is not None:
            if hasattr(usage, "total_tokens"):
                tokens_used = float(getattr(usage, "total_tokens", 0) or 0)
            elif isinstance(usage, dict):
                tokens_used = float(usage.get("total_tokens", 0) or 0)
    except Exception:
        tokens_used = 0.0
    return tokens_used


def _build_baseline_step(
    completion: Any,
    latency: float,
    *,
    fallback_content: str = "",
    candidates: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    try:
        message = completion.choices[0].message if completion and completion.choices else None
    except Exception:
        message = None
    if message is None:
        return None
    content = (getattr(message, "content", None) or fallback_content or "").strip()
    tool_calls = _extract_tool_calls(message)
    action = ""
    action_name = ""
    tool_details = ""
    step_type = "other"
    final_answer = content or None
    if tool_calls:
        first = tool_calls[0]
        fn = first.get("function", {}) if isinstance(first.get("function"), dict) else {}
        name = fn.get("name") or first.get("name") or ""
        action_name = name or ""
        action = f"Call: {action_name}" if action_name else ""
        args = fn.get("arguments")
        if args is None:
            args = first.get("arguments")
        if isinstance(args, dict):
            tool_details = json.dumps(args, ensure_ascii=False)
        elif args is not None:
            tool_details = str(args)
        step_type = "tool"
        final_answer = None
    elif final_answer:
        step_type = "finish"
        action_name = "Finish"
        action = action_name

    distribution: List[Dict[str, Any]] = []
    parsed_payload: Dict[str, Any] = {}
    if content:
        try:
            parsed_payload = extract_json_payload(content)
        except Exception:
            parsed_payload = {}

    if candidates:
        ordered = list(dict.fromkeys(candidates))
        if action_name and action_name not in ordered:
            ordered.append(action_name)
        prob_output = content
        if action_name:
            use_fallback = False
            if prob_output:
                try:
                    payload = extract_json_payload(prob_output)
                    if not isinstance(payload, dict) or ("action_weights" not in payload and "action" not in payload):
                        use_fallback = True
                except Exception:
                    use_fallback = True
            else:
                use_fallback = True
            if use_fallback:
                prob_output = json.dumps({"action": action_name})
        prob_map = extract_and_normalize_probabilities(prob_output or "", ordered)
        distribution = [
            {
                "name": name,
                "prob": float(prob_map.get(name, 0.0)),
                "isSelected": name == action_name,
            }
            for name in ordered
        ]
        if not action_name and prob_map:
            action_name = max(prob_map.items(), key=lambda x: x[1])[0]

    if not action_name and isinstance(parsed_payload, dict):
        payload_action = parsed_payload.get("action") or parsed_payload.get("tool")
        if payload_action:
            action_name = str(payload_action)

    action_args = None
    if isinstance(parsed_payload, dict):
        raw_args = parsed_payload.get("action_args")
        if isinstance(raw_args, dict) and action_name:
            if action_name in raw_args:
                action_args = raw_args.get(action_name)
            else:
                action_args = raw_args
        elif raw_args is not None:
            action_args = raw_args

    if action_args is not None:
        try:
            tool_details = json.dumps(action_args, ensure_ascii=False)
        except Exception:
            tool_details = str(action_args)

    if action_name:
        if action_name == "Finish":
            step_type = "finish"
            if isinstance(action_args, dict) and action_args.get("final_answer"):
                final_answer = action_args.get("final_answer")
        else:
            step_type = "tool"
        action = f"Call: {action_name}" if action_name else action

    tokens_used = _extract_tokens_used(completion)
    if latency <= 0:
        latency = 0.001

    thought = _extract_thought_from_raw_output(content)
    if not thought:
        thought = "no thought"

    return {
        "thought": thought,
        "action": action,
        "toolDetails": tool_details,
        "distribution": distribution,
        "stepType": step_type,
        "finalAnswer": final_answer,
        "metrics": {"latency": float(latency), "tokens": float(tokens_used)},
    }


def _extract_thought_from_raw_output(raw_text: str) -> str:
    if not raw_text:
        return ""

    sanitized = raw_text
    for token in ('"prompt_trace"', '"scoring_messages"', '"execution_messages"'):
        cut = sanitized.find(token)
        if cut != -1:
            sanitized = sanitized[:cut]
            break

    try:
        payload = extract_json_payload(sanitized)
        if isinstance(payload, dict):
            thought_val = payload.get("thought")
            if isinstance(thought_val, str) and thought_val.strip():
                return thought_val.strip()
    except Exception:
        pass

    matches = re.findall(r'"thought"\s*:\s*"((?:\\.|[^"\\])*)"', sanitized, flags=re.DOTALL)
    if matches:
        candidate = matches[-1]
        try:
            return json.loads(f"\"{candidate}\"").strip()
        except Exception:
            return candidate.replace("\\n", "\n").strip()

    lowered = sanitized.lower()
    idx = lowered.rfind('"thought"')
    quote_char = '"'
    if idx == -1:
        idx = lowered.rfind("'thought'")
        quote_char = "'"
    if idx != -1:
        after = sanitized[idx + len(quote_char + "thought" + quote_char):]
        colon = after.find(":")
        if colon != -1:
            rest = after[colon + 1:].lstrip()
            if rest.startswith(("\"", "'")):
                q = rest[0]
                rest = rest[1:]
                buf = []
                escaped = False
                for ch in rest:
                    if escaped:
                        buf.append(ch)
                        escaped = False
                        continue
                    if ch == "\\":
                        buf.append(ch)
                        escaped = True
                        continue
                    if ch == q:
                        break
                    buf.append(ch)
                candidate = "".join(buf)
                try:
                    return json.loads(f"\"{candidate}\"").strip()
                except Exception:
                    return candidate.replace("\\n", "\n").strip()
            else:
                end = len(rest)
                for sep in (",", "\n", "\r", "}"):
                    pos = rest.find(sep)
                    if pos != -1:
                        end = min(end, pos)
                return rest[:end].strip()

    return ""


def _build_add_agent_step(
    watermark: Dict[str, Any],
    step_index: int,
    completion_content: Optional[str],
    completion_tool_calls: Optional[List[Dict[str, Any]]],
    *,
    latency: float,
    tokens: float,
) -> Dict[str, Any]:
    frontend = watermark.get("frontend_data") or {}
    diff = frontend.get("distribution_diff") or []
    distribution = []
    for item in diff:
        prob = item.get("original_prob")
        if prob is None:
            prob = item.get("watermarked_prob", 0)
        distribution.append(
            {
                "name": item.get("action") or "",
                "prob": float(prob),
                "isSelected": bool(item.get("is_selected")),
            }
        )
    action = watermark.get("action") or ""
    action_args = watermark.get("action_args") or {}
    raw_text = watermark.get("raw_llm_output") or ""
    thought = _extract_thought_from_raw_output(raw_text)
    if not thought:
        thought = "no thought"

    bits_embedded = frontend.get("watermark_meta", {}).get("bits_embedded") or 0
    matrix_rows = [[1] for _ in range(int(bits_embedded))]
    final_answer = (completion_content or "").strip()
    if not final_answer and raw_text:
        final_answer = raw_text.strip()
    has_tool_calls = bool(completion_tool_calls)
    step_type = "tool" if action else "other"
    if final_answer and not has_tool_calls:
        step_type = "finish"
    return {
        "stepIndex": step_index,
        "thought": thought,
        "action": f"Call: {action}" if action else "",
        "toolDetails": json.dumps(action_args, ensure_ascii=False),
        "distribution": distribution,
        "watermark": {
            "bits": watermark.get("decoded_bits") or "",
            "matrixRows": matrix_rows,
            "rankContribution": len(matrix_rows),
        },
        "stepType": step_type,
        "metrics": {"latency": float(latency), "tokens": float(tokens)},
        "finalAnswer": final_answer or None,
    }

class InitRequest(BaseModel):
    apiKey: str
    scenarioId: str
    payload: Optional[str] = None

class CustomInitRequest(BaseModel):
    apiKey: str
    query: str
    payload: Optional[str] = None

class StepRequest(BaseModel):
    sessionId: str

class ContinueRequest(BaseModel):
    sessionId: str
    prompt: str


class AddAgentInitRequest(BaseModel):
    apiKey: str
    repoUrl: Optional[str] = ""


class AddAgentTurnRequest(BaseModel):
    sessionId: str
    message: str
    apiKey: Optional[str] = None


class AddAgentEvaluateRequest(BaseModel):
    sessionId: str
    language: Optional[str] = "en"

# --- Helpers ---
def build_messages(query: str, tool_summaries: List[str], admissible_commands: List[str]) -> List[Dict]:
    # Construct System Prompt compatible with ToolBench
    sys_prompt = f"""You are an Auto-GPT agent. Result of your previous step is passed to you.
You have access to the following tools:
{json.dumps(tool_summaries, indent=2)}

You must respond in JSON format with 'thought', 'action', 'action_args', and 'action_weights'.
'action_weights' must be a JSON object mapping EVERY valid action to a STRICTLY POSITIVE number (> 0, not necessarily normalized; the server will normalize them to sum to 1).
IMPORTANT: Do NOT output zeros. Every valid action must have weight > 0 (use small values like 1e-3 if needed).
Valid actions are: {json.dumps(admissible_commands)}
If you have enough information, use "Finish" and provide the final answer in "action_args" as {{"final_answer": "your answer"}}.
"""
    return [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": f"Task: {query}\nBegin!"}
    ]

def extract_and_normalize_probabilities(output: str, candidates: List[str]) -> Dict[str, float]:
    # DeepSeek chat API doesn't expose logprobs in this demo.
    # We therefore:
    #   1) Prefer model-provided `action_weights` if present (normalized).
    #   2) Otherwise, fall back to a biased-but-non-degenerate distribution (multiple "steps"),
    #      to avoid the "one huge + many identical tiny" shape that collapses bins in the UI.

    if not candidates:
        return {}
    if len(candidates) == 1:
        return {candidates[0]: 1.0}

    def _parse_json_payload(text: str) -> Optional[Dict]:
        try:
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end <= start:
                return None
            return json.loads(text[start : end + 1])
        except Exception:
            return None

    def _coerce_nonneg_float(value) -> float:
        try:
            v = float(value)
        except Exception:
            return 0.0
        if not (v == v) or v == float("inf") or v == float("-inf"):
            return 0.0
        return v if v > 0.0 else 0.0

    def _geometric_fallback(top_action: Optional[str]) -> Dict[str, float]:
        # Biased-but-non-degenerate distribution: top_action gets fixed mass,
        # the rest get a geometric decay so p2>p3>... (no flat plateau).
        ratio = 0.75

        if top_action is not None and top_action in candidates:
            top_mass = 0.4
            others = [c for c in candidates if c != top_action]
            denom = sum((ratio**i) for i in range(len(others)))
            if denom <= 0.0:
                return uniform_prob(candidates)

            remainder = 1.0 - top_mass
            scores = {top_action: top_mass}
            for i, c in enumerate(others):
                scores[c] = remainder * (ratio**i) / denom
            return scores

        denom = sum((ratio**i) for i in range(len(candidates)))
        if denom <= 0.0:
            return uniform_prob(candidates)
        return {c: (ratio**i) / denom for i, c in enumerate(candidates)}

    def _mix_distributions(a: Dict[str, float], b: Dict[str, float], alpha: float) -> Dict[str, float]:
        alpha = max(0.0, min(1.0, alpha))
        mixed = {c: alpha * float(a.get(c, 0.0)) + (1.0 - alpha) * float(b.get(c, 0.0)) for c in candidates}
        total = sum(mixed.values())
        if total <= 0.0:
            return uniform_prob(candidates)
        return {k: v / total for k, v in mixed.items()}

    data = _parse_json_payload(output) or {}
    chosen = data.get("action", "Finish")

    raw_weights = data.get("action_weights", None)
    if raw_weights is not None:
        weights: Dict[str, float] = {}
        valid = True

        if isinstance(raw_weights, dict):
            for c in candidates:
                if c not in raw_weights:
                    valid = False
                    break
            for c in candidates:
                weights[c] = _coerce_nonneg_float(raw_weights.get(c, 0.0))
                if weights[c] <= 0.0:
                    valid = False
                    break
        elif isinstance(raw_weights, list) and len(raw_weights) == len(candidates):
            for i, c in enumerate(candidates):
                weights[c] = _coerce_nonneg_float(raw_weights[i])
                if weights[c] <= 0.0:
                    valid = False
                    break
        else:
            valid = False

        if valid:
            total = sum(weights.values())
            if total > 0.0:
                normalized = {k: v / total for k, v in weights.items()}
                top_action = max(normalized.items(), key=lambda x: x[1])[0]
                max_prob = normalized.get(top_action, 0.0)
                if max_prob > 0.9:
                    return _mix_distributions(normalized, _geometric_fallback(top_action), 0.6)
                return normalized

    return _geometric_fallback(chosen if chosen in candidates else None)


def _parse_action_args_from_output(model_output: str, chosen: str) -> Dict[str, Any]:
    try:
        start = model_output.find("{")
        end = model_output.rfind("}")
        json_str = model_output[start:end + 1] if start != -1 and end != -1 else "{}"
        data = json.loads(json_str)
        if "action_args" in data:
            raw_args = data["action_args"]
            if isinstance(raw_args, dict) and chosen in raw_args:
                return raw_args[chosen]
            if isinstance(raw_args, dict):
                return raw_args
        return {}
    except Exception:
        return {}

@app.post("/api/init")
async def init_session(req: InitRequest):
    session_id = f"sess_{int(time.time())}_{req.scenarioId}"
    
    # Load Scenario Data
    # In a real app, this would load from disk/db. 
    # We will use the 'retriever' to find tools for the query if scenario query is custom?
    # For fixed scenarios, we might already have the tool list. 
    # Let's assume we retrieve dynamically for "Live" demo always, or use cached.
    
    task = {
        "query": "Solve task " + req.scenarioId, 
        "api_list": [], # Will be empty, adapter handles fallback or we retrieve
        "id": req.scenarioId,
        "payload_str": req.payload 
    }
    
    # Try retrieve real tools if we know the query? 
    # For now, start empty or basic.
    
    session = Session(session_id, req.apiKey, task, req.payload)
    sessions[session_id] = session
    
    print(f"[INFO] Session {session_id} initialized with Payload: '{task['payload_str']}'")
    
    return {
        "sessionId": session_id,
        "task": {
            "query": task.get("query"),
            "id": req.scenarioId
        },
        "totalSteps": 0, # Start
        "payloadLength": len(req.payload) if req.payload else 16
    }

@app.post("/api/init_custom")
async def init_custom_session(req: CustomInitRequest):
    session_id = f"sess_{int(time.time())}_custom"
    
    print(f"\n[INFO] >>> RECEIVED CUSTOM PROMPT: '{req.query}' <<<")
    
    api_list = []
    if retriever_loading:
        print("[WARN] Retriever is still loading...")
    elif retriever:
        api_list = retriever.retrieve(req.query, top_k=5)
    
    if not api_list:
        print("[WARN] Retriever found no tools or retrieval failed (or loading).")
        
    task = {
        "query": req.query,
        "api_list": api_list,
        "id": "custom_generated",
        "payload_str": req.payload
    }
    
    session = Session(session_id, req.apiKey, task, req.payload)
    sessions[session_id] = session
    
    return {
        "sessionId": session_id,
        "task": {
            "query": task.get("query"),
            "id": task.get("id"),
            "retrieved_tools_count": len(api_list)
        },
        "totalSteps": 0,
        "payloadLength": len(task.get("payload_str", req.payload)) if req.payload else 16 
    }


@app.post("/api/add_agent/start")
async def start_add_agent_session(req: AddAgentInitRequest):
    session_id = f"agent_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    add_agent_sessions[session_id] = AddAgentSession(
        session_id=session_id,
        api_key=req.apiKey,
        repo_url=req.repoUrl or "",
    )
    return {
        "sessionId": session_id,
        "proxyBase": _get_proxy_base(),
    }


@app.post("/api/add_agent/turn")
async def add_agent_turn(req: AddAgentTurnRequest):
    if req.sessionId not in add_agent_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is empty")
    session = add_agent_sessions[req.sessionId]
    model_name = os.getenv("AGENTMARK_TARGET_MODEL", "gpt-4o")
    completion = None
    started_at = time.time()
    use_swarm = (os.getenv("AGENTMARK_USE_SWARM") or "1").strip().lower() not in {"0", "false", "no"}
    use_baseline = (os.getenv("AGENTMARK_ADD_AGENT_BASELINE") or "1").strip().lower() not in {"0", "false", "no"}
    proxy_base = _get_proxy_base()
    agentmark_body = {
        "session_id": session.session_id,
        "context": f"{session.session_id}||step{session.step_count}",
        "use_scoring_tool": True,
    }
    messages = [
        {"role": "system", "content": ADD_AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": req.message.strip()},
    ]

    if use_swarm:
        try:
            from swarm import Swarm

            swarm_client = Swarm(client=_build_proxy_client(req.apiKey or session.api_key))
            completion = swarm_client.get_chat_completion(
                agent=_get_swarm_add_agent(),
                history=[{"role": "user", "content": req.message.strip()}],
                context_variables={},
                model_override=model_name,
                stream=False,
                debug=False,
                extra_body={"agentmark": agentmark_body},
                tools_override=ADD_AGENT_TOOLS,
                temperature=0.0,
            )
        except Exception as exc:
            print(f"[WARN] Swarm bridge failed, falling back to direct call: {exc}")

    if completion is None:
        client = _build_proxy_client(req.apiKey or session.api_key)
        try:
            completion = client.chat.completions.create(
                model=model_name,
                messages=messages,
                tools=ADD_AGENT_TOOLS,
                extra_body={"agentmark": agentmark_body},
                temperature=0.0,
            )
        except Exception as exc:
            detail = f"Proxy call failed ({proxy_base}): {exc}"
            raise HTTPException(status_code=502, detail=detail)
    latency = time.time() - started_at
    baseline_step = None
    baseline_prompt_trace = None
    if use_baseline:
        base_started = time.time()
        try:
            base_client = _build_base_llm_client(req.apiKey or session.api_key)
            base_messages = _build_add_agent_scoring_messages(req.message.strip())
            baseline_prompt_trace = {
                "scoring_messages": base_messages,
                "scoring_prompt_text": _render_prompt_messages(base_messages),
            }
            base_completion = base_client.chat.completions.create(
                model=_resolve_base_model(model_name),
                messages=base_messages,
                temperature=0.0,
            )
            base_latency = time.time() - base_started
            baseline_step = _build_baseline_step(
                base_completion,
                base_latency,
                candidates=_get_add_agent_candidates(),
            )
        except Exception as exc:
            print(f"[WARN] Baseline call failed: {exc}")
    watermark = _extract_watermark(completion)
    if not watermark:
        raise HTTPException(status_code=500, detail="Missing watermark in response")
    completion_message = None
    try:
        if completion and completion.choices:
            completion_message = completion.choices[0].message
    except Exception:
        completion_message = None
    completion_content = ""
    completion_tool_calls: Optional[List[Dict[str, Any]]] = None
    if completion_message is not None:
        completion_content = completion_message.content or ""
        tool_calls = _extract_tool_calls(completion_message)
        if tool_calls:
            completion_tool_calls = tool_calls
    tokens_used = _extract_tokens_used(completion)

    prompt_trace = watermark.get("prompt_trace") or {}
    if tokens_used <= 0:
        scoring_text = prompt_trace.get("scoring_prompt_text") or ""
        exec_text = prompt_trace.get("execution_prompt_text") or ""
        approx = (len(scoring_text) + len(exec_text)) / 4.0
        if approx > 0:
            tokens_used = max(1.0, approx)

    if latency <= 0:
        latency = 0.001

    step = _build_add_agent_step(
        watermark,
        session.step_count,
        completion_content,
        completion_tool_calls,
        latency=latency,
        tokens=tokens_used,
    )
    if baseline_step:
        step["baseline"] = baseline_step
    user_msg = req.message.strip()
    session.last_user_message = user_msg
    if not session.task_query:
        session.task_query = user_msg

    session.watermarked_trajectory.append({"role": "user", "message": user_msg})
    session.baseline_trajectory.append({"role": "user", "message": user_msg})

    wm_action = watermark.get("action") or ""
    wm_args = watermark.get("action_args") or {}
    wm_thought = step.get("thought") or ""
    wm_payload: Dict[str, Any] = {"action": wm_action, "thought": wm_thought}
    if wm_args:
        wm_payload["action_args"] = wm_args
    session.watermarked_trajectory.append(
        {"role": "assistant", "message": json.dumps(wm_payload, ensure_ascii=False)}
    )

    base_payload: Dict[str, Any] = {}
    if baseline_step:
        base_action = (baseline_step.get("action") or "").strip()
        base_action_name = base_action.replace("Call: ", "").strip() if base_action.startswith("Call: ") else base_action
        base_payload = {"action": base_action_name, "thought": baseline_step.get("thought") or ""}
        if base_action_name == "Finish" and baseline_step.get("finalAnswer"):
            base_payload["action_args"] = {"final_answer": baseline_step.get("finalAnswer")}
    else:
        base_payload = wm_payload
    session.baseline_trajectory.append(
        {"role": "assistant", "message": json.dumps(base_payload, ensure_ascii=False)}
    )
    session.step_count += 1
    return {
        "sessionId": req.sessionId,
        "step": step,
        "promptTrace": prompt_trace,
        "baselinePromptTrace": baseline_prompt_trace,
        "watermark": watermark,
    }


@app.post("/api/add_agent/evaluate")
async def evaluate_add_agent(req: AddAgentEvaluateRequest):
    if req.sessionId not in add_agent_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    sess = add_agent_sessions[req.sessionId]
    if not sess.watermarked_trajectory or not sess.baseline_trajectory:
        raise HTTPException(status_code=400, detail="Not enough data to evaluate")

    lang_instruction = "Reasoning must be in English."
    if req.language == "zh":
        lang_instruction = "请使用中文进行简要评价 (Reasoning must be in Chinese)."

    def summarize_trajectory(traj):
        summary = ""
        for t in traj:
            role = t.get("role")
            msg = t.get("message", "")
            if role == "user":
                summary += f"User: {msg}\n"
            elif role == "assistant":
                try:
                    data = json.loads(msg)
                    summary += f"Assistant Thought: {data.get('thought')}\nAssistant Action: {data.get('action')}\n"
                    if "final_answer" in data.get("action_args", {}):
                        summary += f"Assistant Final Answer: {data['action_args']['final_answer']}\n"
                except Exception:
                    summary += f"Assistant: {msg}\n"
            elif role == "tool":
                summary += f"Tool Output: {msg[:200]}...\n"
        return summary

    baseline_summary = summarize_trajectory(sess.baseline_trajectory)
    watermarked_summary = summarize_trajectory(sess.watermarked_trajectory)
    query = sess.task_query or sess.last_user_message or "Add agent task"

    import random
    is_baseline_A = random.choice([True, False])
    if is_baseline_A:
        summary_A = baseline_summary
        summary_B = watermarked_summary
    else:
        summary_A = watermarked_summary
        summary_B = baseline_summary

    prompt = f"""Task: {query}
    
    Model A Trajectory/Answer:
    {summary_A}

    Model B Trajectory/Answer:
    {summary_B}

    Please evaluate Model A and Model B based on the task using criteria such as correctness, efficiency, and helpfulness.
    Provide a score (0-10) for each and a brief reason.
    {lang_instruction}
    
    You must output strictly in JSON format:
    {{
        "model_a_score": <float>,
        "model_b_score": <float>,
        "reason": "<string>"
    }}
    """

    try:
        completion = await sess.async_client.chat.completions.create(
            model=sess.model,
            messages=[
                {"role": "system", "content": "You are an impartial judge evaluating two AI models."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        content = completion.choices[0].message.content or ""
        start = content.find("{")
        end = content.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Invalid evaluation payload")
        json_str = content[start:end+1]
        res_json = json.loads(json_str)

        swapped = not is_baseline_A
        if swapped:
            final_result = {
                "model_a_score": res_json.get("model_b_score", 0),
                "model_b_score": res_json.get("model_a_score", 0),
                "reason": res_json.get("reason", "")
            }
        else:
            final_result = res_json

        sess.evaluation_result = final_result
        return final_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Scenario Persistence ---

@app.get("/api/scenarios")
async def list_scenarios(search: Optional[str] = None, limit: int = 100):
    """List all saved conversations from database with optional search"""
    try:
        scenarios = db.list_conversations(limit=limit, search=search)
        return scenarios
    except Exception as e:
        print(f"[ERROR] Failed to list scenarios: {e}")
        return []

class SaveScenarioRequest(BaseModel):
    title: Any # str or dict
    data: Dict
    id: Optional[str] = None # Optional ID to overwrite

@app.post("/api/save_scenario")
async def save_scenario(req: SaveScenarioRequest):
    """Save conversation to database"""
    try:
        scenario_id = req.id if req.id else str(uuid.uuid4())
        
        scenario_data = req.data
        scenario_data["id"] = scenario_id
        
        # Handle title format
        if isinstance(req.title, str):
            scenario_data["title"] = {"en": req.title, "zh": req.title}
        else:
            scenario_data["title"] = req.title
        
        # Save to database
        db.save_conversation(scenario_data)
        
        print(f"[INFO] Saved scenario {scenario_id} to database")
        return {"status": "success", "id": scenario_id}
    except Exception as e:
        print(f"[ERROR] Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/scenarios/clear_all")
async def clear_all_history():
    """Clear all conversation history from database"""
    try:
        deleted_count = db.clear_all_conversations()
        print(f"[INFO] Cleared all history: {deleted_count} conversations deleted")
        return {"status": "success", "deleted_count": deleted_count}
    except Exception as e:
        print(f"[ERROR] Clear all failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scenarios/batch_delete")
async def batch_delete_scenarios(req: dict):
    """Batch delete multiple scenarios"""
    try:
        scenario_ids = req.get("ids", [])
        if not scenario_ids:
            return {"status": "success", "deleted_count": 0}
        
        deleted_count = 0
        for scenario_id in scenario_ids:
            if db.delete_conversation(scenario_id):
                deleted_count += 1
        
        print(f"[INFO] Batch deleted {deleted_count} scenarios")
        return {"status": "success", "deleted_count": deleted_count}
    except Exception as e:
        print(f"[ERROR] Batch delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scenarios/{scenario_id}/toggle_pin")
async def toggle_pin_scenario(scenario_id: str):
    """Toggle pin status of a conversation"""
    try:
        success = db.toggle_pin(scenario_id)
        if success:
            print(f"[INFO] Toggled pin status for scenario {scenario_id}")
            return {"status": "success", "id": scenario_id}
        else:
            raise HTTPException(status_code=404, detail="Scenario not found")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Toggle pin failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/scenarios/{scenario_id}")
async def delete_scenario(scenario_id: str):
    """Delete a conversation from database"""
    try:
        deleted = db.delete_conversation(scenario_id)
        if deleted:
            print(f"[INFO] Deleted scenario {scenario_id} from database")
            return {"status": "success", "id": scenario_id}
        else:
            raise HTTPException(status_code=404, detail="Scenario not found")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

class GenerateTitleRequest(BaseModel):
    history: List[Dict] # List of {role, content/message}

@app.post("/api/generate_title")
async def generate_title(req: GenerateTitleRequest):
    try:
        # Extract user messages to summarize
        # Limit to first few turns for title generation
        conversation_text = ""
        for turn in req.history[:6]:
            role = turn.get("role", "")
            content = turn.get("message") or turn.get("content") or ""
            if role == "user":
                conversation_text += f"User: {content}\n"
            elif role == "assistant":
                conversation_text += f"Assistant: {content}\n"
        
        if not conversation_text:
            return {"title": "New Conversation"}

        # Use a quick call to generate title
        # We can use the same client
        # Create a temporary client if needed, or reuse one from a session if available?
        # We don't have a session ID here necessarily.
        # But we initialized 'sessions' with keys. We can just instantiate a generic client.
        # However, to avoid global client init if not needed, we can just pick one active session or init a temporary one.
        # OR better: init a global client for utility tasks.
        
        # NOTE: In this demo, we assume we have an API Key.
        # But this request comes from frontend. Does it have API Key?
        # The frontend might not pass API key here if it's "auto save".
        # We should ideally pass API Key in request or reuse global environment variable.
        # For this demo, let's assume we reuse a valid API key from any active session or environment.
        # If no active session, we might fail.
        # Let's check if we have any active session to steal credentials or use a default if configured.
        
        api_key = None
        if sessions:
            api_key = list(sessions.values())[0].client.api_key
        
        if not api_key:
             return {"title": "New Conversation (Untitled)"}

        client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "Generate a very concise title (3-6 words) for this conversation. Output ONLY the title, no quotes."},
                {"role": "user", "content": conversation_text}
            ],
            temperature=0.7,
            max_tokens=20
        )
        
        title = response.choices[0].message.content.strip().replace('"', '')
        return {"title": title}

    except Exception as e:
        print(f"[ERROR] Title generation failed: {e}")
        return {"title": "New Conversation"}



def uniform_prob(commands: List[str]) -> Dict[str, float]:
    p = 1.0 / len(commands) if commands else 0
    return {c: p for c in commands}

class RestoreSessionRequest(BaseModel):
    apiKey: str
    scenarioId: str

@app.post("/api/restore_session")
async def restore_session(req: RestoreSessionRequest):
    """Restore session from database"""
    print(f"[INFO] Restore session request for scenarioId: {req.scenarioId}")
    
    # 1. Load saved scenario from database
    data = db.get_conversation(req.scenarioId)
    
    if not data:
        print(f"[ERROR] Scenario {req.scenarioId} not found in database")
        # List all available conversations for debugging
        all_convs = db.list_conversations(limit=10)
        print(f"[INFO] Available conversations: {[c['id'] for c in all_convs]}")
        raise HTTPException(status_code=404, detail="Saved scenario not found")
    
    print(f"[INFO] Found scenario in database: {data.get('id')}, steps: {len(data.get('steps', []))}")

    # 2. Init Session
    session_id = f"sess_{int(time.time())}_{req.scenarioId}_restored"
    
    # Extract task details from saved data
    # Saved data has 'steps', 'userQuery', etc.
    task = {
        "query": data.get("userQuery") or "Restored Task",
        "api_list": [], # We will rely on retrieval for next steps or assume stateless
        "id": req.scenarioId,
        "payload_str": data.get("payload") or "11001101"
    }
    
    # 3. Create Session
    session = Session(session_id, req.apiKey, task, task["payload_str"])
    
    # 4. Reconstruct Trajectory from Steps
    # This is "best effort" mapping from UI-steps to internal-trajectory
    # UI Step Types: 'user_input', 'thought' (with action/tool), 'tool', 'finish'
    
    watermarked_trajectory = []
    baseline_trajectory = []
    
    steps = data.get("steps", [])
    
    # We need to map steps to (User, Assistant, Tool) messages.
    # Logic:
    # - if stepType == 'user_input': -> User Message
    # - if stepType == 'thought' or 'finish': -> Assistant Message (reconstruct JSON)
    # - if stepType == 'tool': -> Tool Message (Observation)
    
    # Let's iterate and reconstruct
    for step in steps:
        s_type = step.get("stepType", "thought")
        
        if s_type == "user_input":
            # User messages are the same for both agents
            user_msg = {"role": "user", "message": step.get("thought") or step.get("action")}
            watermarked_trajectory.append(user_msg)
            baseline_trajectory.append(user_msg)
            
        elif s_type in ["thought", "finish", "tool"]:
            # Reconstruct Watermarked Agent's messages
            thought = step.get("thought", "")
            action = step.get("action", "")
            final_answer = step.get("finalAnswer")
            
            # Helper to parse "Call: ToolName" -> ToolName
            chosen_tool = "Finish"
            if action.startswith("Call: "):
                chosen_tool = action.replace("Call: ", "").strip()
            elif action == "Finish":
                chosen_tool = "Finish"
            
            # Reconstruct Dict for watermarked agent
            model_out_dict = {
                "action": chosen_tool,
                "action_args": {},
                "thought": thought
            }
            
            if chosen_tool == "Finish" and final_answer:
                 model_out_dict["action_args"] = { "final_answer": final_answer }
            
            # Store as string (mocking the LLM raw output)
            watermarked_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
            
            # Add observation for watermarked agent
            obs = step.get("toolDetails") or step.get("observation")
            if obs and chosen_tool != "Finish":
                watermarked_trajectory.append({"role": "tool", "message": obs})
            
            # Reconstruct Baseline Agent's messages (if exists)
            baseline_data = step.get("baseline")
            if baseline_data:
                baseline_thought = baseline_data.get("thought", "")
                baseline_action = baseline_data.get("action", "")
                baseline_final_answer = baseline_data.get("finalAnswer")
                
                # Parse baseline action
                baseline_tool = "Finish"
                if baseline_action.startswith("Call: "):
                    baseline_tool = baseline_action.replace("Call: ", "").strip()
                elif baseline_action == "Finish":
                    baseline_tool = "Finish"
                
                # Reconstruct Dict for baseline agent
                baseline_model_dict = {
                    "action": baseline_tool,
                    "action_args": {},
                    "thought": baseline_thought
                }
                
                if baseline_tool == "Finish" and baseline_final_answer:
                    baseline_model_dict["action_args"] = { "final_answer": baseline_final_answer }
                
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(baseline_model_dict)})
                
                # Add observation for baseline agent
                baseline_obs = baseline_data.get("toolDetails") or baseline_data.get("observation")
                if baseline_obs and baseline_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": baseline_obs})
            else:
                # If no baseline data, copy watermarked data
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
                if obs and chosen_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": obs})

    # Hydrate both agents with their respective trajectories
    session.watermarked_state.trajectory = watermarked_trajectory
    session.baseline_state.trajectory = baseline_trajectory
    
    # Set step count
    session.watermarked_state.step_count = len(steps)
    session.baseline_state.step_count = len(steps)
    
    # Store session
    sessions[session_id] = session
    
    print(f"[INFO] Restored session {session_id} with {len(watermarked_trajectory)} watermarked turns and {len(baseline_trajectory)} baseline turns.")
    print(f"[INFO] Session stored in sessions dict. Total sessions: {len(sessions)}")
    print(f"[INFO] Session keys: {list(sessions.keys())}")
    
    return {
        "sessionId": session_id,
        "task": {
             "query": task["query"],
             "id": req.scenarioId
        },
        "restoredSteps": len(steps)
    }

@app.post("/api/continue")
async def continue_session(req: ContinueRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    # Retrieve new tools for the continuation prompt
    print(f"\n[INFO] >>> RECEIVED CONTINUE PROMPT: '{req.prompt}' <<<\n")
    if retriever:
        new_tools = retriever.retrieve(req.prompt, top_k=5)
        if new_tools:
            print(f"[INFO] Retrieved {len(new_tools)} new tools for continuation.")
            
            # Helper to update agent state with new tools
            def update_agent_tools(agent_state: AgentState):
                # Basic dedup check
                current_tools = agent_state.task.get("api_list", [])
                existing_names = {t.get("func_name") or t.get("api_name") for t in current_tools}
                
                for tool in new_tools:
                    t_name = tool.get("func_name") or tool.get("api_name")
                    if t_name not in existing_names:
                        current_tools.append(tool)
                        existing_names.add(t_name)
                
                agent_state.task["api_list"] = current_tools
                
                # CRITICAL: Re-initialize episode to refresh tool summaries and admissible commands
                try:
                    updated_episode = agent_state.adapter.prepare_episode(agent_state.task)
                    agent_state.episode["tool_summaries"] = updated_episode["tool_summaries"]
                    agent_state.episode["admissible_commands"] = updated_episode["admissible_commands"]
                except Exception as e:
                    print(f"[ERROR] Failed to refresh episode context for {agent_state.role}: {e}")

            # Update both agents
            update_agent_tools(sess.watermarked_state)
            update_agent_tools(sess.baseline_state)
            print("[INFO] Updated tools for both agents.")
            
    
    # Append user prompt to trajectory for both
    sess.watermarked_state.trajectory.append({"role": "user", "message": req.prompt})
    sess.baseline_state.trajectory.append({"role": "user", "message": req.prompt})
    
    # Extend max steps to allow continuation
    sess.max_steps += 10
    
    # CRITICAL: Reset done state so agents continue
    sess.watermarked_state.done = False
    sess.baseline_state.done = False
    
    return {"status": "success", "message": "Session continued", "new_max_steps": sess.max_steps}

@app.post("/api/step")
async def step_session(req: StepRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    use_shared_thought = (os.getenv("AGENTMARK_BASELINE_SHARE_THOUGHT") or "1").strip().lower() not in {"0", "false", "no"}
    use_swarm_baseline = (os.getenv("AGENTMARK_BASELINE_USE_SWARM") or "1").strip().lower() not in {"0", "false", "no"}
    if use_shared_thought:
        use_swarm_baseline = False
    
    if sess.watermarked_state.step_count >= sess.max_steps:
        # Return immediate JSON for consistency if done
        def immediate_done():
            yield json.dumps({
                "type": "result",
                "data": {
                    "agent": "watermarked",
                    "done": True,
                    "thought": "Max steps reached",
                    "action": "Finish",
                    "observation": "",
                    "final_answer": "",
                    "distribution": [],
                    "metrics": {"latency": 0.0, "tokens": 0.0},
                },
            }) + "\n"
            yield json.dumps({
                "type": "result",
                "data": {
                    "agent": "baseline",
                    "done": True,
                    "thought": "Max steps reached",
                    "action": "Finish",
                    "observation": "",
                    "final_answer": "",
                    "distribution": [],
                    "metrics": {"latency": 0.0, "tokens": 0.0},
                },
            }) + "\n"
        return StreamingResponse(immediate_done(), media_type="application/x-ndjson")

    # --- Generic Single Agent Step Function ---
    async def step_single_agent(
        agent_state: AgentState,
        is_watermarked: bool,
        output_queue: asyncio.Queue,
        *,
        mirror_agent: Optional[str] = None,
        capture_output: bool = False,
    ):
        step_start_time = time.time()
        
        # Check done state
        if agent_state.done:
            final_data = {
                "agent": agent_state.role,
                "thought": "",
                "action": "Finish",
                "observation": "",
                "done": True,
                "final_answer": "",
                "distribution": [],
                "metrics": {
                    "latency": 0.0,
                    "tokens": 0.0,
                },
            }

            shared_payload = None
            if is_watermarked:
                watermark_data = {
                    "bits": "",
                    "matrixRows": [],
                    "rankContribution": 0,
                }
                return final_data, watermark_data, 0, shared_payload

            return final_data, None, 0, shared_payload

        if (not is_watermarked) and use_swarm_baseline:
            try:
                if not agent_state.swarm_history:
                    agent_state.swarm_history.append(
                        {
                            "role": "user",
                            "content": f"Task: {agent_state.task.get('query', '')}\nBegin!",
                        }
                    )

                tools_override = _build_toolbench_tools(agent_state.episode["tool_summaries"])
                from swarm import Swarm

                swarm_client = Swarm(client=sess.client)
                completion = swarm_client.get_chat_completion(
                    agent=_get_swarm_toolbench_agent(),
                    history=agent_state.swarm_history,
                    context_variables={},
                    model_override=sess.model,
                    stream=False,
                    debug=False,
                    tools_override=tools_override,
                    temperature=0.0,
                )

                message = completion.choices[0].message
                tool_calls = message.tool_calls or []
                content = (message.content or "").strip()

                chosen = "Finish"
                action_args: Dict[str, Any] = {}
                tool_call_id = None
                if tool_calls:
                    first_call = tool_calls[0]
                    chosen = first_call.function.name
                    tool_call_id = first_call.id
                    raw_args = first_call.function.arguments or "{}"
                    try:
                        action_args = json.loads(raw_args)
                    except Exception:
                        action_args = {}
                else:
                    if content:
                        action_args = {"final_answer": content}

                admissible = agent_state.episode["admissible_commands"]
                if chosen not in admissible:
                    chosen = "Finish"
                    if content:
                        action_args = {"final_answer": content}
                    else:
                        action_args = {}

                probs = uniform_prob(admissible)
                distribution = [
                    {"name": k, "prob": v, "isSelected": k == chosen}
                    for k, v in probs.items()
                ]

                model_output = json.dumps(
                    {
                        "thought": content,
                        "action": chosen,
                        "action_args": action_args,
                        "action_weights": probs,
                    },
                    ensure_ascii=False,
                )
                agent_state.trajectory.append({"role": "assistant", "message": model_output})

                agent_state.swarm_history.append(message.model_dump())

                final_answer_text = ""
                if chosen == "Finish":
                    if isinstance(action_args, dict):
                        final_answer_text = action_args.get("final_answer", "")
                    if not final_answer_text:
                        final_answer_text = content

                action_obj = {"tool": chosen, "arguments": action_args}
                step_result_obs = await asyncio.to_thread(
                    agent_state.adapter.step,
                    action_obj,
                    agent_state.episode["tool_summaries"],
                    state=agent_state.task,
                )
                observation = step_result_obs["observation"]
                done = step_result_obs.get("done", False) or chosen == "Finish"

                if chosen != "Finish":
                    tool_message = {"role": "tool", "content": observation}
                    if tool_call_id:
                        tool_message["tool_call_id"] = tool_call_id
                    agent_state.swarm_history.append(tool_message)

                agent_state.trajectory.append({"role": "tool", "message": observation})
                agent_state.last_observation = observation
                agent_state.step_count += 1
                agent_state.done = done

                obs_display = observation
                if not done and len(observation) > 200:
                    obs_display = observation[:200] + "..."

                step_latency = time.time() - step_start_time
                est_tokens = len(content) / 4 if content else 0.0

                final_data = {
                    "agent": agent_state.role,
                    "thought": content or ("Thinking..." if not done else ""),
                    "action": f"Call: {chosen}",
                    "observation": obs_display,
                    "done": done,
                    "final_answer": final_answer_text if done else "",
                    "distribution": distribution,
                    "stepIndex": agent_state.step_count - 1,
                    "metrics": {"latency": step_latency, "tokens": est_tokens},
                }
                return final_data, None, 0, None
            except Exception as e:
                print(f"[ERROR] Swarm baseline error: {e}")

        # 1. Build Messages
        messages = build_messages(
            query=agent_state.task.get("query", ""),
            tool_summaries=agent_state.episode["tool_summaries"],
            admissible_commands=agent_state.episode["admissible_commands"]
        )
        # Add history
        for turn in agent_state.trajectory:
            if turn["role"] == "assistant":
                 messages.append({"role": "assistant", "content": turn["message"]})
            elif turn["role"] == "tool":
                 # Simulate tool output as user message (ToolBench style)
                 messages.append({"role": "user", "content": f"Observation:\n{turn['message']}\nContinue Thought/Action/Action Input."})
            elif turn["role"] == "user":
                 messages.append({"role": "user", "content": turn["message"]})

        # 2. Call LLM
        model_output = ""
        try:
            print(f"[DEBUG] Call LLM ({agent_state.role})")
            # ENABLE STREAMING
            response_stream = await sess.async_client.chat.completions.create(
                model=sess.model, 
                messages=messages,
                temperature=0.0,
                max_tokens=512,
                stream=True 
            )
            
            async for chunk in response_stream:
                content = chunk.choices[0].delta.content
                if content:
                    model_output += content
                    # Stream thought chunk
                    # We assume everything is thought until we parse it fully later, or we just stream raw text.
                    # Ideally we would only stream if it's NOT inside a JSON structure, but for "Thinking...", 
                    # showing the raw generation is fine and "hacky" but works for visual effect.
                    await output_queue.put({
                        "type": "thought",
                        "agent": agent_state.role,
                        "content": content
                    })
                    if mirror_agent:
                        await output_queue.put({
                            "type": "thought",
                            "agent": mirror_agent,
                            "content": content
                        })

        except Exception as e:
            print(f"[ERROR] Step Model Error ({agent_state.role}): {e}")
            model_output = json.dumps({
                "action_weights": uniform_prob(agent_state.episode["admissible_commands"]),
                "action_args": {},
                "thought": "API Call Failed. Using fallback."
            })

        # 3. Process Result
        probs = extract_and_normalize_probabilities(model_output, agent_state.episode["admissible_commands"])
        if not probs:
            probs = uniform_prob(agent_state.episode["admissible_commands"])
            
        effective_probs = probs.copy() 
        
        chosen = "Finish"
        consumed_bits = 0
        
        # Sampling Strategy
        if is_watermarked:
            # Differential Sampling
            bit_before = sess.bit_index
            
            # 1. Fetch chunk from RLNC
            # We need enough bits for the sampler. The sampler typically consumes log2(N) bits, plus potentially more.
            # Let's fetch a safe chunk of 64 bits from the infinite stream
            # The sampler takes specific # of bits.
            # Ideally the sampler should take the stream object or we guess.
            # Our `sample_behavior_differential` implementation takes `bit_stream` as string.
            # We generate a chunk of 64 bits starting at bit_index.
            
            chunk_length = 64
            rlnc_chunk = sess.rlnc.get_stream(start_index=sess.bit_index, length=chunk_length)
            
            # 2. Call Real Sampler
            # Note: The real sampler signature is:
            # sample_behavior_differential(probabilities, bit_stream, bit_index, context_for_key=None, history_responses=None, seed=None, round_num=0)
            # IMPORTANT: The `bit_index` arg in sampler acts as an offset into the passed `bit_stream`.
            # Since we pass a fresh chunk, we should pass index 0 to the sampler, OR pass the full virtual stream?
            # Passing full virtual stream is impossible.
            # We pass the chunk, and tell sampler index is 0 relative to chunk.
            
            chosen, target_list, consumed_bits, context_used = sample_behavior_differential(
                probabilities=effective_probs,
                bit_stream=rlnc_chunk,
                bit_index=0, # relative to chunk
                context_for_key=agent_state.last_observation, # context
                round_num=agent_state.step_count
            )
            
            # consumed_bits is how many bits from chunk were used.
            # sess.bit_index += consumed_bits (Done below)

        else:
            # Baseline: Max Prob (Greedy) or simple Random
            # Greedy for stability
            if effective_probs:
                chosen = max(effective_probs.items(), key=lambda x: x[1])[0]
            else:
                 chosen = "Finish"

        # Parse Action Args
        action_args = _parse_action_args_from_output(model_output, chosen)

        action_obj = {"tool": chosen, "arguments": action_args}
        
        # Update History
        agent_state.trajectory.append({"role": "assistant", "message": model_output})
        
        # Thought Extraction
        thought = ""
        if "Thought:" in model_output:
            thought = model_output.split("Thought:")[1].split("{")[0].strip()
        elif "thought:" in model_output:
             thought = model_output.split("thought:")[1].split("{")[0].strip()
        else:
            parts = model_output.split("{", 1)
            if len(parts) > 1 and parts[0].strip():
                thought = parts[0].strip().replace("```json", "").replace("```", "").strip()
            else:
                try:
                    start = model_output.find("{")
                    end = model_output.rfind("}")
                    if start != -1 and end != -1:
                       json_str = model_output[start:end+1]
                       data = json.loads(json_str)
                       thought = data.get("thought", "")
                except:
                    pass
        
        # Fallback: if thought is still empty but we have content
        if not thought and model_output.strip() and not model_output.strip().startswith("{"):
             # Just take the text before the first brace
             thought = model_output.split("{")[0].strip()

        shared_payload = None
        if capture_output:
            shared_payload = {
                "model_output": model_output,
                "probs": probs,
                "thought": thought,
            }

        # Extract Final Answer
        final_answer_text = ""
        if chosen == "Finish":
            print(f"\n[DEBUG] RAW MODEL OUTPUT (Finish): {model_output}\n")
            if isinstance(action_args, dict):
                final_answer_text = action_args.get("final_answer", "")
            elif isinstance(action_args, str):
                final_answer_text = action_args
            
            # Fallback text extraction for final answer if JSON failed
            if not final_answer_text:
                import re
                try:
                    # Try to find "Final Answer:" pattern
                    fa_match = re.search(r"Final Answer:\s*(.*)", model_output, re.IGNORECASE | re.DOTALL)
                    if fa_match:
                         final_answer_text = fa_match.group(1).strip()
                except:
                    pass
            
            # If thought is empty but we have final answer, use final answer as thought for display if needed
            # if not thought and final_answer_text:
            #     thought = "Task Completed." 

        # Execute Tool
        step_result_obs = await asyncio.to_thread(agent_state.adapter.step, action_obj, agent_state.episode["tool_summaries"], state=agent_state.task)
        observation = step_result_obs["observation"]
        done = step_result_obs.get("done", False) or chosen == "Finish"
        
        agent_state.trajectory.append({"role": "tool", "message": observation})
        agent_state.last_observation = observation
        agent_state.step_count += 1
        agent_state.done = done

        # Prepare Result Dict
        obs_display = observation
        if not done and len(observation) > 200:
            obs_display = observation[:200] + "..."

        step_latency = time.time() - step_start_time
        est_tokens = len(model_output) / 4 
        
        # Decide default thought
        default_thought = "Thinking..." if not done else ""
        
        final_data = {
            "agent": agent_state.role, # 'watermarked' or 'baseline'
            "thought": thought or default_thought,
            "action": f"Call: {chosen}",
            "observation": obs_display,
            "done": done,
            "final_answer": final_answer_text, # Explicitly send final answer
            "distribution": [{"name": k, "prob": v, "isSelected": k==chosen} for k, v in probs.items()],
            "stepIndex": agent_state.step_count - 1,
            "metrics": {
                "latency": step_latency,
                "tokens": est_tokens
            }
        }
        
        watermark_data = {}
        if is_watermarked:
            # Watermark Trace
            # Get the exact bits consumed
            embedded_bits = sess.rlnc.get_stream(start_index=sess.bit_index, length=consumed_bits)
            
            matrix_rows = []
            
            # Generate real RLNC coefficients for the consumed bits
            # The bits consumed were at absolute indices [sess.bit_index ... sess.bit_index + consumed_bits - 1]
            for i in range(consumed_bits):
                abs_idx = sess.bit_index + i
                coeffs = sess.rlnc._generate_coeffs(abs_idx)
                matrix_rows.append(coeffs)
            
            watermark_data = {
                "bits": embedded_bits,
                "matrixRows": matrix_rows,
                "rankContribution": len(embedded_bits)
            }
            return final_data, watermark_data, consumed_bits, shared_payload
        
        return final_data, None, 0, shared_payload


    async def step_baseline_from_shared(agent_state: AgentState, shared_payload: Dict[str, Any]):
        step_start_time = time.time()

        if agent_state.done:
            final_data = {
                "agent": agent_state.role,
                "thought": "",
                "action": "Finish",
                "observation": "",
                "done": True,
                "final_answer": "",
                "distribution": [],
                "metrics": {
                    "latency": 0.0,
                    "tokens": 0.0,
                },
            }
            return final_data, None, 0, None

        model_output = shared_payload.get("model_output") or ""
        probs = shared_payload.get("probs") or {}
        thought = shared_payload.get("thought") or ""

        admissible = agent_state.episode["admissible_commands"]
        effective_probs = probs if probs else uniform_prob(admissible)

        chosen = "Finish"
        if effective_probs:
            chosen = max(effective_probs.items(), key=lambda x: x[1])[0]

        if chosen not in admissible:
            chosen = "Finish"

        action_args = _parse_action_args_from_output(model_output, chosen)
        if chosen == "Finish" and not action_args and thought:
            action_args = {"final_answer": thought}

        action_obj = {"tool": chosen, "arguments": action_args}

        agent_state.trajectory.append({"role": "assistant", "message": model_output})

        step_result_obs = await asyncio.to_thread(
            agent_state.adapter.step,
            action_obj,
            agent_state.episode["tool_summaries"],
            state=agent_state.task,
        )
        observation = step_result_obs["observation"]
        done = step_result_obs.get("done", False) or chosen == "Finish"

        agent_state.trajectory.append({"role": "tool", "message": observation})
        agent_state.last_observation = observation
        agent_state.step_count += 1
        agent_state.done = done

        obs_display = observation
        if not done and len(observation) > 200:
            obs_display = observation[:200] + "..."

        step_latency = time.time() - step_start_time
        est_tokens = len(model_output) / 4 if model_output else 0.0

        final_answer_text = ""
        if chosen == "Finish":
            if isinstance(action_args, dict):
                final_answer_text = action_args.get("final_answer", "")
            if not final_answer_text:
                final_answer_text = thought

        distribution = [
            {"name": k, "prob": v, "isSelected": k == chosen}
            for k, v in effective_probs.items()
        ]

        final_data = {
            "agent": agent_state.role,
            "thought": thought or ("Thinking..." if not done else ""),
            "action": f"Call: {chosen}",
            "observation": obs_display,
            "done": done,
            "final_answer": final_answer_text if done else "",
            "distribution": distribution,
            "stepIndex": agent_state.step_count - 1,
            "metrics": {"latency": step_latency, "tokens": est_tokens},
        }

        return final_data, None, 0, None


    # MAIN GENERATOR
    async def step_generator():
        queue = asyncio.Queue()

        share_now = use_shared_thought and not sess.watermarked_state.done and not sess.baseline_state.done

        if share_now:
            task_wm = asyncio.create_task(
                step_single_agent(
                    sess.watermarked_state,
                    True,
                    queue,
                    mirror_agent="baseline",
                    capture_output=True,
                )
            )

            pending_tasks = {task_wm}

            while pending_tasks:
                queue_task = asyncio.create_task(queue.get())

                done, pending = await asyncio.wait(
                    pending_tasks | {queue_task},
                    return_when=asyncio.FIRST_COMPLETED
                )

                if queue_task in done:
                    chunk = queue_task.result()
                    yield json.dumps(chunk) + "\n"
                else:
                    queue_task.cancel()

                for t in done:
                    if t in pending_tasks:
                        pending_tasks.remove(t)

            while not queue.empty():
                chunk = await queue.get()
                yield json.dumps(chunk) + "\n"

            try:
                result_wm = await task_wm
                if result_wm:
                    final_data_wm, wm_trace, consumed, shared_payload = result_wm
                    sess.bit_index += consumed
                    final_data_wm["watermark"] = wm_trace
                    yield json.dumps({"type": "result", "data": final_data_wm}) + "\n"

                    if shared_payload:
                        result_bl = await step_baseline_from_shared(sess.baseline_state, shared_payload)
                        if result_bl:
                            final_data_bl, _, _, _ = result_bl
                            final_data_bl["watermark"] = { "bits": "", "matrixRows": [], "rankContribution": 0 }
                            yield json.dumps({"type": "result", "data": final_data_bl}) + "\n"

            except Exception as e:
                print(f"[ERROR] Task execution failed: {e}")
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            return

        # Create tasks
        task_wm = asyncio.create_task(step_single_agent(sess.watermarked_state, True, queue))
        task_bl = asyncio.create_task(step_single_agent(sess.baseline_state, False, queue))

        pending_tasks = {task_wm, task_bl}

        while pending_tasks:
            # Wait for either queue item or task completion
            # We create a task for queue.get()
            queue_task = asyncio.create_task(queue.get())

            done, pending = await asyncio.wait(
                pending_tasks | {queue_task},
                return_when=asyncio.FIRST_COMPLETED
            )

            # Handle queue item
            if queue_task in done:
                chunk = queue_task.result()
                yield json.dumps(chunk) + "\n"
            else:
                queue_task.cancel()

            # Handle agent tasks completion
            for t in done:
                if t in pending_tasks:
                    pending_tasks.remove(t)

        # Consume any remaining queue items
        while not queue.empty():
            chunk = await queue.get()
            yield json.dumps(chunk) + "\n"

        # Get results
        try:
            result_wm = await task_wm
            result_bl = await task_bl

            # Unpack Watermark Result
            if result_wm:
                final_data_wm, wm_trace, consumed, _ = result_wm
                sess.bit_index += consumed
                final_data_wm["watermark"] = wm_trace
                yield json.dumps({"type": "result", "data": final_data_wm}) + "\n"

            # Unpack Baseline Result
            if result_bl:
                final_data_bl, _, _, _ = result_bl
                final_data_bl["watermark"] = { "bits": "", "matrixRows": [], "rankContribution": 0 }
                yield json.dumps({"type": "result", "data": final_data_bl}) + "\n"

        except Exception as e:
            print(f"[ERROR] Task execution failed: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(step_generator(), media_type="application/x-ndjson")
    
class EvaluateRequest(BaseModel):
    sessionId: str
    language: Optional[str] = "en"  # "en" or "zh"

@app.post("/api/evaluate")
async def evaluate_session(req: EvaluateRequest):
    print(f"[INFO] Evaluate request for session: {req.sessionId}")
    print(f"[INFO] Available sessions: {list(sessions.keys())}")
    
    if req.sessionId not in sessions:
        print(f"[ERROR] Session {req.sessionId} not found in sessions dict")
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    # Language Instruction
    lang_instruction = "Reasoning must be in English."
    if req.language == "zh":
        lang_instruction = "请使用中文进行简要评价 (Reasoning must be in Chinese)."

    # helper to summarize trajectory
    def summarize_trajectory(traj):
        summary = ""
        for t in traj:
            role = t["role"]
            msg = t["message"]
            if role == "user":
                summary += f"User: {msg}\n"
            elif role == "assistant":
                # Try parse thought/action
                try:
                    data = json.loads(msg)
                    summary += f"Assistant Thought: {data.get('thought')}\nAssistant Action: {data.get('action')}\n"
                    if "final_answer" in data.get("action_args", {}):
                         summary += f"Assistant Final Answer: {data['action_args']['final_answer']}\n"
                except:
                    summary += f"Assistant: {msg}\n"
            elif role == "tool":
                summary += f"Tool Output: {msg[:200]}...\n"
        return summary

    baseline_summary = summarize_trajectory(sess.baseline_state.trajectory)
    watermarked_summary = summarize_trajectory(sess.watermarked_state.trajectory)
    query = sess.watermarked_state.task.get("query", "Unknown Task")

    # Anti-Bias: Randomize Order
    import random
    is_baseline_A = random.choice([True, False])

    if is_baseline_A:
        summary_A = baseline_summary
        summary_B = watermarked_summary
    else:
        summary_A = watermarked_summary
        summary_B = baseline_summary
    
    prompt = f"""Task: {query}
    
    Model A Trajectory/Answer:
    {summary_A}

    Model B Trajectory/Answer:
    {summary_B}

    Please evaluate Model A and Model B based on the task using criteria such as correctness, efficiency, and helpfulness.
    Provide a score (0-10) for each and a brief reason.
    {lang_instruction}
    
    You must output strictly in JSON format:
    {{
        "model_a_score": <float>,
        "model_b_score": <float>,
        "reason": "<string>"
    }}
    """
    
    try:
        completion = await sess.async_client.chat.completions.create(
            model=sess.model,
            messages=[
                {"role": "system", "content": "You are an impartial judge evaluating two AI models."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        content = completion.choices[0].message.content
        # parse json
        try:
            start = content.find("{")
            end = content.rfind("}")
            json_str = content[start:end+1]
            raw_result = json.loads(json_str)

            # Map back to specific models
            if is_baseline_A:
                result = {
                    "model_a_score": raw_result.get("model_a_score", 0),
                    "model_b_score": raw_result.get("model_b_score", 0),
                    "reason": raw_result.get("reason", "")
                }
            res_json = json.loads(json_str)

            swapped = not is_baseline_A
            # map scores back to Baseline vs Ours
            # If swapped (Model A was Watermarked), then A was Ours, B was Base.
            # We want output: model_a_score=Base, model_b_score=Ours
            final_result = {}
            if swapped:
                 final_result = {
                     "model_a_score": res_json.get("model_b_score", 0), # A (now Base) = B (was Base)
                     "model_b_score": res_json.get("model_a_score", 0), # B (now Ours) = A (was Ours)
                     "reason": res_json.get("reason", "")
                 }
            else:
                 final_result = res_json

            sess.evaluation_result = final_result # Persist in session

            # Update the database with evaluation result
            try:
                # Try to get the original scenario ID from the session
                original_id = sess.watermarked_state.task.get("id") or sess.baseline_state.task.get("id")
                
                # If session ID contains "_restored", extract the original ID
                if "_restored" in req.sessionId:
                    # Format: sess_timestamp_ORIGINAL_ID_restored
                    parts = req.sessionId.split("_")
                    if len(parts) >= 3:
                        # Find the part that's not "sess", not a timestamp, and not "restored"
                        for part in parts:
                            if part not in ["sess", "restored"] and not part.isdigit():
                                original_id = part
                                break
                
                print(f"[INFO] Attempting to save evaluation for scenario: {original_id}")
                
                if original_id:
                    existing = db.get_conversation(original_id)
                    if existing:
                        existing["evaluation"] = final_result
                        db.save_conversation(existing)
                        print(f"[INFO] Successfully updated evaluation for scenario {original_id} in database")
                    else:
                        print(f"[WARN] Scenario {original_id} not found in database")
                else:
                    print(f"[WARN] Could not determine original scenario ID from session {req.sessionId}")
            except Exception as save_err:
                print(f"[WARN] Failed to auto-save evaluation to database: {save_err}")
                import traceback
                traceback.print_exc()

            return final_result
            
        except Exception as e:
            print("JSON Parse Error:", e)
            return {"model_a_score": 0, "model_b_score": 0, "reason": "Failed to parse result"}
            
    except Exception as e:
        print("Evaluation Error:", e)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
