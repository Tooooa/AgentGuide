
import json
import time
import uuid

def inject_top_k_prompt(messages: list, tools: list, k: int = 3) -> list:
    """
    Injects a system prompt to instruct the LLM to output Top-K candidates.
    """
    tool_definitions = json.dumps([t["function"] for t in tools], indent=2)
    
    system_instruction = (
        f"You are a helpful assistant. You have access to the following tools:\n{tool_definitions}\n\n"
        f"DO NOT execute the tools directly. Instead, I want you to evaluate the best tools to use for the user's request.\n"
        f"Please output a JSON object containing your reasoning and a list of top {k} candidate tool calls.\n"
        f"Format MUST be:\n"
        f"{{\n"
        f'  "reasoning": "Step-by-step thought process...",\n'
        f'  "candidates": [\n'
        f'    {{"name": "tool_name", "args": {{...}}, "probability": 0.8}},\n'
        f'    {{"name": "tool_name_2", "args": {{...}}, "probability": 0.1}}\n'
        f'  ]\n'
        f"}}\n"
        f"Ensure probabilities sum to roughly 1.0. If no tool is needed, perform a 'reply' action.\n"
        f"Output ONLY valid JSON."
    )
    
    # Insert at the beginning or append to existing system prompt
    new_messages = [{"role": "system", "content": system_instruction}] + messages
    return new_messages

def parse_top_k_response(response: dict) -> tuple:
    """
    Parses the LLM's JSON output to extract candidates and reasoning.
    Returns: (candidates_list, reasoning_str)
    """
    try:
        content = response["choices"][0]["message"]["content"]
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        
        data = json.loads(content)
        candidates = data.get("candidates", [])
        reasoning = data.get("reasoning", "")
        
        results = []
        for c in candidates:
            results.append({
                "name": c.get("name"),
                "args": json.dumps(c.get("args")), # Args must be string for ToolCall
                "prob": float(c.get("probability", 0.0))
            })
        return results, reasoning
    except Exception as e:
        print(f"[ProxyUtils] Parse Error: {e} | Content: {content[:100]}...")
        raise e

def construct_tool_call_response(original_model: str, tool_name: str, tool_args: str, content: str = None) -> dict:
    """
    Constructs a standard OpenAI ChatCompletion response representing a Tool Call.
    Optionally includes content (reasoning).
    """
    tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
    
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": original_model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,  # Now allowing reasoning content
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": tool_args
                            }
                        }
                    ]
                },
                "logprobs": None,
                "finish_reason": "tool_calls"
            }
        ],
        "usage": {
            "prompt_tokens": 0, # Mock usage
            "completion_tokens": 0,
            "total_tokens": 0
        },
        "system_fingerprint": "fp_agentmark_proxy"
    }
