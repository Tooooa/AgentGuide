
import os
import json
import httpx
import traceback
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from agentmark.core.watermark_sampler import sample_behavior_differential
from proxy_utils import inject_top_k_prompt, parse_top_k_response, construct_tool_call_response

app = FastAPI(title="AgentMark Universal Proxy")

# Configuration
UPSTREAM_BASE_URL = os.getenv("UPSTREAM_BASE_URL", "https://api.deepseek.com")
UPSTREAM_API_KEY = os.getenv("UPSTREAM_API_KEY") 
WATERMARK_PAYLOAD = os.getenv("WATERMARK_PAYLOAD", "110101")

# In-Memory Session State (For PoC only. Use Redis for production)
session_store = {}

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """
    Intercepts chat completion requests.
    If tools are present, applies Single-Pass Watermarking.
    Otherwise, forwards transparently.
    """
    try:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        # 1. Check if this is a Tool Call request
        tools = body.get("tools")
        if not tools:
            # Transparent Forwarding
            return await forward_request(body)

        # 2. Single-Pass Transformation
        # Modify prompt to ask for Top-K candidates
        original_messages = body.get("messages", [])
        modified_messages = inject_top_k_prompt(original_messages, tools, k=3)
        
        # Prepare upstream request (forcing JSON mode for parsing)
        upstream_body = body.copy()
        upstream_body["messages"] = modified_messages
        upstream_body.pop("tools", None) # Remove tools to prevent auto-execution by LLM
        upstream_body.pop("tool_choice", None)
        upstream_body["response_format"] = {"type": "json_object"}
        upstream_body["model"] = "deepseek-chat" # Hardcode for now to ensure compatibility
        
        print(f"[Proxy] Forwarding Top-K request to upstream...")
        
        # 3. Call Upstream LLM
        upstream_response = await call_upstream(upstream_body)
        
        # 4. Parse Candidates
        try:
            candidates, reasoning = parse_top_k_response(upstream_response) # Returns (list, reasoning)
        except Exception as e:
            print(f"[Proxy] Parsing failed: {e}. Fallback to original request.")
            return await forward_request(body)
            
        if not candidates:
            print("[Proxy] No candidates returned. Fallback to original request.")
            return await forward_request(body)

        # 5. Watermark Sampling
        # Identify Session (Simple: based on last message content hash)
        last_msg_content = str(original_messages[-1].get("content", ""))
        session_key = str(hash(last_msg_content)) 
        state = session_store.get(session_key, {"bit_index": 0, "round_num": 0})
        
        # Prepare distribution for SDK
        tool_probs = {c["name"]: c["prob"] for c in candidates}
        # Normalize
        total = sum(tool_probs.values())
        if total > 0:
            tool_probs = {k: v/total for k,v in tool_probs.items()}
        
        # Context for randomness
        context_str = f"cnt:{state['round_num']}|msg:{last_msg_content[:20]}"
        
        print(f"[Proxy] Sampling from: {tool_probs.keys()}")
        
        selected_tool_name, _, bits_embedded, _ = sample_behavior_differential(
            probabilities=tool_probs,
            bit_stream=WATERMARK_PAYLOAD,
            bit_index=state["bit_index"],
            context_for_key=context_str,
            round_num=state["round_num"]
        )
        
        # Update State
        state["bit_index"] += bits_embedded
        state["round_num"] += 1
        session_store[session_key] = state
        
        print(f"[Proxy] Selected: {selected_tool_name} (Embedded: {bits_embedded} bits)")

        # 6. Find selected candidate details
        selected_candidate = next((c for c in candidates if c["name"] == selected_tool_name), candidates[0])
        
        # 7. Construct Response
        final_response = construct_tool_call_response(
            original_model=body.get("model", "gpt-4"),
            tool_name=selected_candidate["name"],
            tool_args=selected_candidate["args"],
            content=reasoning # Inject reasoning
        )
        
        return JSONResponse(content=final_response)

    except Exception as e:
        print(f"[Proxy] Critical Error: {e}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": traceback.format_exc()})

async def forward_request(body: dict):
    """Forwards request transparently to upstream."""
    try:
        response = await call_upstream(body) 
        return JSONResponse(content=response)
    except Exception as e:
        return JSONResponse(status_code=502, content={"error": f"Upstream failed: {str(e)}"})

async def call_upstream(body: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {UPSTREAM_API_KEY}",
        "Content-Type": "application/json"
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Note: DeepSeek API uses OpenAI compatible format
        # Ensure model name is correct for DeepSeek if using DeepSeek endpoint
        if "deepseek" in UPSTREAM_BASE_URL:
             body["model"] = "deepseek-chat"
             
        resp = await client.post(
            f"{UPSTREAM_BASE_URL}/chat/completions",
            json=body,
            headers=headers
        )
        if resp.status_code != 200:
            print(f"[Proxy] Upstream Error: {resp.status_code} - {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
