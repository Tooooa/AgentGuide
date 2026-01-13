"""
Robustness test with a "realistic" dinner scenario.
- Simulates LLM outputs with varying JSON formats (plain, code fence, single quotes).
- Uses PromptWatermarkWrapper to parse, sample, and decode.
- Asserts decode matches payload prefix for each step.

Run: PYTHONPATH=. python3 tests/prompt_dinner.py
"""

import random
from agentmark.sdk import AgentWatermarker, PromptWatermarkWrapper


def make_fake_output(probs, fmt="plain"):
    payload = {
        "action_weights": probs,
        "action_args": {k: {"info": "arg"} for k in probs},
        "thought": "choosing dinner",
    }
    if fmt == "plain":
        import json
        return json.dumps(payload, ensure_ascii=False)
    if fmt == "code":
        import json
        return "```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```"
    if fmt == "single":
        # single quotes and no strict JSON
        return str(payload)
    return str(payload)


def random_probs(actions):
    vals = [random.random() for _ in actions]
    s = sum(vals)
    return {a: v / s for a, v in zip(actions, vals)}


def run_dinner_test():
    actions = ["点外卖", "做炒饭", "煮面", "不吃"]
    wm = AgentWatermarker(payload_bits="1101")
    wrapper = PromptWatermarkWrapper(wm)

    formats = ["plain", "code", "single"]
    decoded_all = ""
    for step in range(6):
        probs = random_probs(actions)
        fmt = random.choice(formats)
        raw = make_fake_output(probs, fmt)
        ctx = f"dinner||step{step}"
        start_idx = wm._bit_index
        res = wrapper.process(
            raw_output=raw,
            fallback_actions=actions,
            context=ctx,
            history=[f"obs{step}"],
        )
        # Decode and assert prefix
        round_used = res["frontend_data"]["watermark_meta"]["round_num"]
        bits = wm.decode(
            probabilities=res["probabilities_used"],
            selected_action=res["action"],
            context=ctx,
            round_num=round_used,
        )
        count = res["frontend_data"]["watermark_meta"]["bits_embedded"]
        expected_step = wm._bit_stream[start_idx : start_idx + count]
        assert bits.startswith(expected_step), (
            f"step {step} mismatch bits {bits} vs expected {expected_step}"
        )
        decoded_all += expected_step
        expected_prefix = wm._bit_stream[: len(decoded_all)]
        assert decoded_all == expected_prefix, (
            f"step {step} mismatch decoded_all {decoded_all} vs expected {expected_prefix}"
        )
        print(
            f"[step {step}] fmt={fmt} action={res['action']}, bits={bits}, "
            f"orig_probs={res['probabilities_used']}"
        )
    print("All steps passed. Decoded prefix:", decoded_all)


if __name__ == "__main__":
    run_dinner_test()
