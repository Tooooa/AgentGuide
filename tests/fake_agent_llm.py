"""
Real LLM integration test with DeepSeek.
- Injects strict JSON scoring prompt
- Parses self-reported probabilities, runs watermark sampling, and decodes bits

Prerequisites:
- Set env DEEPSEEK_API_KEY (do NOT hardcode keys in code)
- Network access to https://api.deepseek.com

Run:
    PYTHONPATH=. DEEPSEEK_API_KEY=sk-xxx python3 tests/fake_agent_llm.py
"""

import os
import argparse
from openai import OpenAI

from agentmark.sdk import AgentWatermarker, PromptWatermarkWrapper


def build_messages(wrapper: PromptWatermarkWrapper, candidates, user_task: str):
    base_system = (
        "你是一个决策助手。返回每个候选动作的概率，且只输出 JSON。\n"
        + wrapper.get_instruction()
    )
    user_prompt = user_task + "\n候选动作：\n" + "\n".join(f"- {c}" for c in candidates)
    return [
        {"role": "system", "content": base_system},
        {"role": "user", "content": user_prompt},
    ]


def run_once(client, wrapper, wm, candidates, context, user_task):
    messages = build_messages(wrapper, candidates, user_task)
    print("[info] Sending request to DeepSeek...")
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=messages,
        temperature=0.2,
        max_tokens=300,
    )
    raw_text = resp.choices[0].message.content
    print("[raw LLM output]\n", raw_text)

    result = wrapper.process(
        raw_output=raw_text,
        fallback_actions=candidates if candidates else None,
        context=context,
        history=[f"task: {user_task}"],
    )
    print("\n[watermark result]")
    print("selected action:", result["action"])
    print("probabilities used:", result["probabilities_used"])
    print("frontend distribution diff:", result["frontend_data"]["distribution_diff"])

    round_used = result["frontend_data"]["watermark_meta"]["round_num"]
    bits = wm.decode(
        probabilities=result["probabilities_used"],
        selected_action=result["action"],
        context=context,
        round_num=round_used,
    )
    print("decoded bits (this step):", bits)
    # Validate prefix
    expected = wm._bit_stream[: len(bits)]
    if bits != expected:
        print(f"[warn] decoded bits {bits} != expected prefix {expected}")
    return bits


def main():
    parser = argparse.ArgumentParser(description="DeepSeek watermark integration test")
    parser.add_argument("--payload", default="1101", help="payload bits")
    parser.add_argument("--rounds", type=int, default=1, help="number of calls")
    parser.add_argument(
        "--task",
        default="今天晚上吃什么？",
        help="user task description to include in prompt",
    )
    args = parser.parse_args()

    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY not set.")

    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")

    wm = AgentWatermarker(payload_bits=args.payload)
    wrapper = PromptWatermarkWrapper(wm)
    candidates = ["点外卖", "做炒饭", "煮面", "不吃"]

    all_bits = ""
    for i in range(args.rounds):
        ctx = f"dinner||round{i}"
        bits = run_once(client, wrapper, wm, candidates, ctx, args.task)
        all_bits += bits
        expected_prefix = wm._bit_stream[: len(all_bits)]
        if all_bits != expected_prefix:
            print(f"[warn] cumulative bits {all_bits} != expected {expected_prefix}")
        print("-" * 60)
    print("[summary] total decoded bits:", all_bits)


if __name__ == "__main__":
    main()
