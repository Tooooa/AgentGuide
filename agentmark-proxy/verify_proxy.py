
from openai import OpenAI
import os

# Point to our Local Proxy
client = OpenAI(
    base_url="http://localhost:8001/v1",
    api_key="any-key" # Proxy handles auth to upstream
)

print("--- Requesting Tool Call via Proxy ---")

tools = [
    {
        "type": "function",
        "function": {
            "name": "flight_search",
            "description": "Search for flights",
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string"}
                },
                "required": ["destination"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "weather_check",
            "description": "Check weather",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"}
                },
                "required": ["city"]
            }
        }
    }
]

messages = [
    {"role": "user", "content": "I want to go to Paris. Can you check flights and weather?"}
]

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=messages,
    tools=tools
)

print("\n--- Response Received ---")
print(response)

# Check if it looks like a standard tool call
choice = response.choices[0]
if choice.finish_reason == "tool_calls":
    tc = choice.message.tool_calls[0]
    print(f"\nSUCCESS: Received Tool Call via Proxy!")
    print(f"Tool: {tc.function.name}")
    print(f"Args: {tc.function.arguments}")
    print(f"Reasoning: {choice.message.content}")
else:
    print("\nFAILURE: Did not receive tool call.")
