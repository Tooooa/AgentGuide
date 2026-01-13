"""
Multi-action trace runner for the AgentMark proxy.
Prints request payloads and LLM raw outputs (from watermark.raw_llm_output).

Usage:
  export DEEPSEEK_API_KEY=sk-xxx
  python tests/multi_action_trace.py --proxy-base http://localhost:8001/v1 --session demo
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any, Dict, List

import requests


TASKS = [
    "What's the weather in NYC?",
    "Give me a 3-day weather forecast for Tokyo.",
    "How is the air quality in Beijing today?",
    "Send an email to alice@example.com with subject 'Hello' and body 'Test message'.",
    "Send an SMS to +14155550123 saying 'On my way'.",
]


TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
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
            "name": "get_weather_forecast",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "days": {"type": "integer"},
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_air_quality",
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
            "parameters": {
                "type": "object",
                "properties": {
                    "phone_number": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["phone_number", "message"],
            },
        },
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Trace multiple actions via proxy.")
    parser.add_argument("--proxy-base", default="http://localhost:8001/v1")
    parser.add_argument("--session", default="demo")
    parser.add_argument("--model", default="gpt-4o")
    args = parser.parse_args()

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "X-AgentMark-Session": args.session,
    }

    for idx, task in enumerate(TASKS, start=1):
        payload = {
            "model": args.model,
            "messages": [{"role": "user", "content": task}],
            "tools": TOOLS,
        }
        print(f"\n=== STEP {idx}: {task}")
        print("[request]")
        print(json.dumps(payload, ensure_ascii=False, indent=2))

        resp = requests.post(
            f"{args.proxy_base}/chat/completions",
            headers=headers,
            json=payload,
            timeout=120,
        )
        if resp.status_code != 200:
            print(resp.text)
            resp.raise_for_status()

        data = resp.json()
        watermark = data.get("watermark") or {}
        print("\n[llm_raw_output]")
        print(watermark.get("raw_llm_output"))
        tool_calls = (
            (data.get("choices") or [{}])[0]
            .get("message", {})
            .get("tool_calls")
        )
        print("\n[tool_calls]")
        print(json.dumps(tool_calls, ensure_ascii=False, indent=2))
        print("\n[watermark]")
        print(json.dumps(watermark, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
