"""
Configuration utilities for the dashboard server.
"""
import os
from pathlib import Path
from typing import Optional
from fastapi import HTTPException


# --- Path Configuration ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SWARM_ROOT = PROJECT_ROOT / "swarm"
TOOL_DATA_ROOT = PROJECT_ROOT / "experiments/toolbench/data/data/toolenv/tools"


def load_root_dotenv() -> None:
    """Best-effort loader for PROJECT_ROOT/.env without external deps."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if not key:
                continue
            os.environ.setdefault(key, value)
    except Exception:
        # Avoid breaking server startup due to .env formatting issues.
        return


def resolve_api_key(request_api_key: Optional[str]) -> str:
    """Resolve API key from request or environment variables."""
    candidate = (request_api_key or "").strip()
    if candidate:
        return candidate
    env_key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
    if env_key:
        return env_key
    env_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if env_key:
        return env_key
    raise HTTPException(
        status_code=400,
        detail="Missing API key. Provide apiKey in request or set DEEPSEEK_API_KEY (preferred) / OPENAI_API_KEY in environment.",
    )


def get_base_llm_base() -> str:
    """Get base URL for LLM API."""
    return os.getenv("AGENTMARK_LLM_BASE", "https://api.deepseek.com")


def resolve_base_model(model_name: str) -> str:
    """Resolve model name to actual model identifier."""
    # Map common model names to DeepSeek equivalents
    model_map = {
        "gpt-4o": "deepseek-chat",
        "gpt-4o-mini": "deepseek-chat",
        "gpt-4-turbo": "deepseek-chat",
        "gpt-4": "deepseek-chat",
        "gpt-3.5-turbo": "deepseek-chat",
    }
    return model_map.get(model_name, model_name)


# Initialize environment on import
load_root_dotenv()
