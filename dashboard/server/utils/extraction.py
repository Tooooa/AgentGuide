import json
import re
from typing import Dict, List, Optional, Any
from agentmark.sdk.prompt_adapter import extract_json_payload

def extract_watermark(completion: Any) -> Optional[Dict[str, Any]]:
    try:
        extra = getattr(completion, "model_extra", None)
        if extra and isinstance(extra, dict) and extra.get("watermark"):
            return extra.get("watermark")
        extra = getattr(completion, "__pydantic_extra__", None)
        if extra and isinstance(extra, dict) and extra.get("watermark"):
            return extra.get("watermark")
        # Fallback to model_dump if available
        if hasattr(completion, "model_dump"):
            payload = completion.model_dump()
            return payload.get("watermark")
        return None
    except Exception:
        return None

def extract_tool_calls(message: Any) -> List[Dict[str, Any]]:
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

def extract_tokens_used(completion: Any) -> float:
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

def extract_thought_from_raw_output(raw_text: str) -> str:
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

def uniform_prob(commands: List[str]) -> Dict[str, float]:
    p = 1.0 / len(commands) if commands else 0
    return {c: p for c in commands}

def extract_and_normalize_probabilities(output: str, candidates: List[str]) -> Dict[str, float]:
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

def parse_action_args_from_output(model_output: str, chosen: str) -> Dict[str, Any]:
    try:
        start = model_output.find("{")
        end = model_output.rfind("}")
        json_str = model_output[start:end + 1] if start != -1 and end != -1 else "{}"
        
        try:
            data = json.loads(json_str, strict=False)
        except json.JSONDecodeError:
            # Fallback: try to escape unescaped newlines which are common in LLM output
            try:
                # Naive cleanup: remove raw newlines from the string
                cleaned_str = json_str.replace('\n', '\\n').replace('\r', '')
                data = json.loads(cleaned_str, strict=False)
            except:
                 # If clean fallback also fails, return empty
                return {}

        if "action_args" in data:
            raw_args = data["action_args"]
            if isinstance(raw_args, dict) and chosen in raw_args:
                return raw_args[chosen]
            if isinstance(raw_args, dict):
                return raw_args
        return {}
    except Exception:
        return {}

def build_baseline_step(
    completion: Any,
    latency: float,
    *,
    fallback_content: str = "",
    candidates: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    # NOTE: This function logic was heavily interspersed in app.py.
    # Re-implmenting it cleanly using helper functions.
    
    try:
        message = completion.choices[0].message if completion and completion.choices else None
    except Exception:
        message = None
    if message is None:
        return None
    content = (getattr(message, "content", None) or fallback_content or "").strip()
    tool_calls = extract_tool_calls(message)
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
        
        # Fallback if probability parsing fails or is missing
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

    # Try to extract action/args from parsed payload if still missing
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

    tokens_used = extract_tokens_used(completion)
    if latency <= 0:
        latency = 0.001

    thought = extract_thought_from_raw_output(content)
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
