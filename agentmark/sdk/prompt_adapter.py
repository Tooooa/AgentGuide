"""
Helpers for prompt-driven integrations where the LLM outputs action probabilities
in JSON form (black-box API scenario).
"""

from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Optional, Tuple, Any

from agentmark.sdk import AgentWatermarker

DEFAULT_PROB_TEMPERATURE = 1.0
DEFAULT_MIN_WEIGHT = 1e-4


PROMPT_INSTRUCTION = """You are an action-selection assistant.
Return ONLY JSON with your probability over all candidate actions.
Example:
{
  "action_weights": {"Action1": 0.5, "Action2": 0.3, "Action3": 0.2},
  "action_args": {"Action1": {"arg": "value"}, "Action2": {"arg": "value"}, "Action3": {"arg": "value"}},
  "thought": "your thought here"
}
Requirements:
- action_weights MUST include every candidate (or top-K if instructed).
- All action_weights MUST be > 0. Use small values like 1e-3 for unlikely actions.
- action_args should include the chosen action. Other candidates may be omitted or left as empty objects.
  If you include other candidates, keep arguments minimal and consistent with the tool schema.
- Sum does not need to be exact; we will normalize.
- All action_weights must be > 0; do NOT return all zeros.
- Avoid uniform weights; if uncertain, break ties with slight preferences by candidate order.
- If a tool named "agentmark_score_actions" is available, call it with the JSON instead of writing text.
- Do NOT output any extra text or code fences.
- Provide a concise rationale in the thought field (no extra sections)."""


def get_prompt_instruction() -> str:
    """Return a tested prompt suffix to force LLM to emit JSON scores."""
    return PROMPT_INSTRUCTION


def _find_json(text: str) -> Optional[str]:
    """
    Best-effort extraction of the first JSON object from a string.
    """
    try:
        return json.dumps(json.loads(text))
    except Exception:
        pass

    # Fallback: locate outermost braces
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        try:
            json.loads(candidate)
            return candidate
        except Exception:
            return None
    return None


def _strip_code_fence(text: str) -> str:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1)
    return text


def extract_json_payload(raw_output: str) -> Dict:
    """
    Robustly extract a JSON object from LLM output (handles code fences / loose text).
    Returns {} on failure.
    """
    candidate = _strip_code_fence(raw_output)
    candidate = _find_json(candidate) or candidate
    try:
        return json.loads(candidate)
    except Exception:
        # naive single-quote fix
        try:
            fixed = candidate.replace("'", '"')
            return json.loads(fixed)
        except Exception:
            return {}


def parse_action_weights(raw_output: str) -> Dict[str, float]:
    """
    Parse LLM text output to extract action_weights dict.

    Returns an empty dict if parsing fails (caller should fallback to uniform).
    """
    data = extract_json_payload(raw_output)
    if not data:
        return {}

    weights = data.get("action_weights") or data.get("action_probs") or data.get("scores")
    if not isinstance(weights, dict):
        return {}

    # Only keep numeric values
    result = {}
    for k, v in weights.items():
        try:
            result[str(k)] = float(v)
        except Exception:
            continue
    return result


def normalize_probabilities(probs: Dict[str, float]) -> Dict[str, float]:
    """
    Normalize probability dict; drops non-positive totals by returning empty.
    """
    total = float(sum(probs.values()))
    if total <= 0:
        return {}
    min_val = float(_getenv("AGENTMARK_MIN_WEIGHT") or 0.0)
    if min_val > 0:
        probs = {k: max(float(v), min_val) for k, v in probs.items()}
        total = float(sum(probs.values()))
    return {k: float(v) / total for k, v in probs.items()}


def apply_temperature(probs: Dict[str, float], temperature: float) -> Dict[str, float]:
    """
    Apply temperature scaling to soften or sharpen probabilities.
    temperature > 1.0 -> flatter; temperature < 1.0 -> sharper.
    """
    if not probs:
        return probs
    if temperature <= 0:
        return probs
    if abs(temperature - 1.0) < 1e-6:
        return probs
    scaled = {k: float(v) ** (1.0 / temperature) for k, v in probs.items()}
    return normalize_probabilities(scaled)


def _force_uniform(probs: Dict[str, float], fallback_actions: Optional[List[str]]) -> Dict[str, float]:
    keys = list(probs.keys()) if probs else list(fallback_actions or [])
    if not keys:
        return probs
    uniform = 1.0 / len(keys)
    return {k: uniform for k in keys}


def _maybe_bias_uniform(
    probs: Dict[str, float],
    fallback_actions: Optional[List[str]],
    *,
    tol: float = 1e-6,
) -> Dict[str, float]:
    if not probs:
        return probs
    values = list(probs.values())
    if max(values) - min(values) > tol:
        return probs
    keys = list(fallback_actions or probs.keys())
    if not keys:
        return probs
    try:
        decay = float(_getenv("AGENTMARK_UNIFORM_BIAS_DECAY") or 0.3)
    except ValueError:
        decay = 0.3
    decay = min(max(decay, 0.0), 1.0)
    if decay <= 0.0:
        return probs
    weights = {k: decay ** i for i, k in enumerate(keys)}
    return normalize_probabilities(weights)


def _getenv(name: str) -> Optional[str]:
    # Local import for safety in reloaded contexts.
    import os as _os

    return _os.getenv(name)


def _env_flag(name: str) -> bool:
    value = _getenv(name)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def choose_action_from_prompt_output(
    wm: AgentWatermarker,
    *,
    raw_output: str,
    fallback_actions: Optional[List[str]] = None,
    context: str = "",
    history: Optional[List[str]] = None,
    round_num: Optional[int] = None,
) -> Tuple[str, Dict[str, float]]:
    """
    Parse LLM prompt output, run watermark sampling, and return action + used probabilities.

    Args:
        wm: AgentWatermarker instance.
        raw_output: Text returned by LLM (should contain JSON with action_weights).
        fallback_actions: Candidate actions to use if parsing fails.
        context/history/round_num: Passed to wm.sample for key sync.

    Returns:
        (selected_action, probabilities_used)
    """
    weights = parse_action_weights(raw_output)
    probs = normalize_probabilities(weights)

    if not probs:
        # Fallback: uniform over provided candidates (if any)
        if fallback_actions:
            uniform = 1.0 / len(fallback_actions)
            probs = {a: uniform for a in fallback_actions}
        else:
            raise ValueError("No probabilities parsed and no fallback_actions provided.")

    if _env_flag("AGENTMARK_FORCE_UNIFORM"):
        probs = _force_uniform(probs, fallback_actions)

    temp_env = _getenv("AGENTMARK_PROB_TEMPERATURE")
    if temp_env is None:
        probs = apply_temperature(probs, DEFAULT_PROB_TEMPERATURE)
    elif temp_env.strip():
        try:
            probs = apply_temperature(probs, float(temp_env))
        except ValueError:
            pass
    probs = _maybe_bias_uniform(probs, fallback_actions)

    res = wm.sample(probabilities=probs, context=context, history=history, round_num=round_num)
    return res.action, probs


class PromptWatermarkWrapper:
    """
    High-level helper for prompt-driven integrations (black-box LLM).
    """

    def __init__(self, wm: AgentWatermarker):
        self.wm = wm

    def get_instruction(self) -> str:
        """Prompt suffix to force JSON probabilities."""
        return get_prompt_instruction()

    def process(
        self,
        raw_output: str,
        *,
        fallback_actions: Optional[List[str]] = None,
        context: str = "",
        history: Optional[List[str]] = None,
        round_num: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Parse LLM output -> normalize probs -> watermark sampling.

        Returns a dict with action, action_args (if provided), probabilities_used, frontend_data, raw_payload.
        """
        payload = extract_json_payload(raw_output)
        weights = {}
        if isinstance(payload, dict):
            weights = payload.get("action_weights") or payload.get("action_probs") or payload.get("scores") or {}

        probs: Dict[str, float] = {}
        if fallback_actions:
            try:
                min_weight = float(_getenv("AGENTMARK_MIN_WEIGHT") or DEFAULT_MIN_WEIGHT)
            except ValueError:
                min_weight = DEFAULT_MIN_WEIGHT
            min_weight = max(min_weight, 0.0)
            filled: Dict[str, float] = {}
            if isinstance(weights, dict):
                for action in fallback_actions:
                    if action in weights:
                        raw_val = weights.get(action, 0.0)
                        try:
                            raw_val = float(raw_val)
                        except Exception:
                            raw_val = 0.0
                        if raw_val <= 0.0:
                            raw_val = min_weight
                        filled[action] = raw_val
                    else:
                        filled[action] = min_weight
            else:
                for action in fallback_actions:
                    filled[action] = min_weight
            probs = normalize_probabilities(filled)
        elif weights:
            probs = normalize_probabilities(weights)

        if not probs:
            if fallback_actions:
                uniform = 1.0 / len(fallback_actions)
                probs = {a: uniform for a in fallback_actions}
            else:
                raise ValueError("No probabilities parsed and no fallback_actions provided.")

        if _env_flag("AGENTMARK_FORCE_UNIFORM"):
            probs = _force_uniform(probs, fallback_actions)

        temp_env = _getenv("AGENTMARK_PROB_TEMPERATURE")
        if temp_env is None:
            probs = apply_temperature(probs, DEFAULT_PROB_TEMPERATURE)
        elif temp_env.strip():
            try:
                probs = apply_temperature(probs, float(temp_env))
            except ValueError:
                pass
        probs = _maybe_bias_uniform(probs, fallback_actions)

        res = self.wm.sample(probabilities=probs, context=context, history=history, round_num=round_num)

        action_args_map = {}
        if isinstance(payload, dict):
            action_args_map = payload.get("action_args") or payload.get("args") or {}
        action_args = action_args_map.get(res.action) if isinstance(action_args_map, dict) else None

        # Fallback: if action_args is None, but we have a non-empty map that doesn't look like candidates
        if action_args is None and isinstance(action_args_map, dict) and action_args_map:
            # Check if keys overlap with candidates (if known)
            keys = set(action_args_map.keys())
            candidates = set(probs.keys())
            # If no overlap, assume the map *is* the args for the selected action
            if not keys.intersection(candidates):
                action_args = action_args_map

        frontend_data = {
            "watermark_meta": {
                "enabled": True,
                "bits_embedded": res.bits_embedded,
                "bit_index": res.bit_index,
                "payload_length": res.payload_length,
                "context": res.context_used,
                "round_num": res.round_num,
                "is_mock": res.is_mock,
            },
            "distribution_diff": res.distribution_diff,
            "target_behaviors": res.target_behaviors,
            "probabilities_used": probs,
        }

        return {
            "action": res.action,
            "action_args": action_args,
            "probabilities_used": probs,
            "frontend_data": frontend_data,
            "raw_payload": payload,
        }
