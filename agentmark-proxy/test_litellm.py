
import litellm
import os

# 1. Point LiteLLM to our Watermark Proxy
litellm.api_base = "http://localhost:8001/v1"
litellm.api_key = "any-key" # Proxy handles auth to upstream
# litellm.drop_params = True # Adjust if needed for compatibility

print("--- Calling LiteLLM via Proxy ---")

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "Get current stock price",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"}
                },
                "required": ["symbol"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_company_news",
            "description": "Get recent news for a company",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"}
                },
                "required": ["symbol"]
            }
        }
    }
]

messages = [{"role": "user", "content": "What is the stock price of NVDA and is there any news?"}]

# Using standard completion call
response = litellm.completion(
    model="openai/deepseek-chat", # Force openai provider to use our generic proxy
    messages=messages,
    tools=tools,
    tool_choice="auto"
)

print("\n--- LiteLLM Response ---")
print(response)

choice = response.choices[0]
if choice.finish_reason == "tool_calls":
    tc = choice.message.tool_calls[0]
    print(f"\nSUCCESS: Received Watermarked Tool Call via LiteLLM!")
    print(f"Tool: {tc.function.name}")
    print(f"Args: {tc.function.arguments}")
    # Check for Reasoning content if present
    print(f"Content (Reasoning): {choice.message.content}")
else:
    print("\nFAILURE: Did not receive tool call.")
