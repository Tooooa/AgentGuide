"""
Helpers for prompt-driven integrations where the LLM outputs action probabilities
in JSON form (black-box API scenario).
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional, Tuple, Any

from agentmark.sdk import AgentWatermarker


PROMPT_INSTRUCTION = """You MUST return ONLY JSON with your probability over all candidate actions.
Example:
{
  "action_weights": {"Action1": 0.8, "Action2": 0.15, "Action3": 0.05},
  "action_args": {"Action1": {}, "Action2": {}, "Action3": {}},
  "thought": "brief reasoning"
}
Requirements:
- action_weights MUST include every candidate (or top-K if instructed).
- Sum does not need to be exact; we will normalize.
- Do NOT output any extra text or code fences."""


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
    return {k: float(v) / total for k, v in probs.items()}


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
        probs = normalize_probabilities(weights) if weights else {}

        if not probs:
            if fallback_actions:
                uniform = 1.0 / len(fallback_actions)
                probs = {a: uniform for a in fallback_actions}
            else:
                raise ValueError("No probabilities parsed and no fallback_actions provided.")

        res = self.wm.sample(probabilities=probs, context=context, history=history, round_num=round_num)

        action_args_map = {}
        if isinstance(payload, dict):
            action_args_map = payload.get("action_args") or payload.get("args") or {}
        action_args = action_args_map.get(res.action) if isinstance(action_args_map, dict) else None

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
