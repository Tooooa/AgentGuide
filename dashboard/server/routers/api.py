import time
import json
import asyncio
import os
import re
import tiktoken
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from typing import List, Dict, Optional, Any

from dashboard.server.models.api_requests import (
    CustomInitRequest, StepRequest, ContinueRequest, 
    GenerateTitleRequest, RestoreSessionRequest, EvaluateRequest
)
from dashboard.server.core.session import Session, sessions, AgentState
from dashboard.server.utils.config import resolve_api_key
from dashboard.server.utils.extraction import (
    build_baseline_step, extract_and_normalize_probabilities,
    extract_json_payload, extract_thought_from_raw_output,
    parse_action_args_from_output, uniform_prob
)
from dashboard.server.agents.swarm_agent import build_toolbench_tools
from dashboard.server.database import ConversationDB
from dashboard.server.utils.config import PROJECT_ROOT

# Import retriever (will be injected/mocked or we use global access)
# For now, we rely on app.py injecting it or we access it directly through the service module
# We can import it from the service module directly
from dashboard.server.services.retriever_service import get_retriever, is_retriever_loading

# Import watermark sampler
from agentmark.core.watermark_sampler import sample_behavior_differential

db = ConversationDB(db_path=str(PROJECT_ROOT / "dashboard/data/conversations.db"))

router = APIRouter()

# --- Helpers ---
def build_messages(query: str, tool_summaries: List[str], admissible_commands: List[str]) -> List[Dict]:
    # Construct System Prompt compatible with ToolBench
    sys_prompt = f"""You are an Auto-GPT agent. Result of your previous step is passed to you.
You have access to the following tools:
{json.dumps(tool_summaries, indent=2)}

You must respond in JSON format with 'thought', 'action', 'action_args', and 'action_weights'.
'action_weights' must be a JSON object mapping EVERY valid action to a STRICTLY POSITIVE number (> 0, not necessarily normalized; the server will normalize them to sum to 1).
IMPORTANT: Do NOT output zeros. Every valid action must have weight > 0 (use small values like 1e-3 if needed).
Valid actions are: {json.dumps(admissible_commands)}
If you have enough information, use "Finish" and provide the final answer in "action_args" as {{"final_answer": "your answer"}}.
"""
    return [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": f"Task: {query}\nBegin!"}
    ]


@router.post("/api/init_custom")
async def init_custom_session(req: CustomInitRequest):
    session_id = f"sess_{int(time.time())}_custom"
    
    print(f"\n[INFO] >>> RECEIVED CUSTOM PROMPT: '{req.query}' <<<")
    
    retriever = get_retriever()
    api_list = []
    if is_retriever_loading():
        print("[WARN] Retriever is still loading...")
    elif retriever:
        api_list = retriever.retrieve(req.query, top_k=5)
    
    if not api_list:
        print("[WARN] Retriever found no tools or retrieval failed (or loading).")
        
    task = {
        "query": req.query,
        "api_list": api_list,
        "id": "custom_generated",
        "payload_str": req.payload
    }
    
    api_key = resolve_api_key(req.apiKey)
    session = Session(session_id, api_key, task, req.payload)
    sessions[session_id] = session
    
    return {
        "sessionId": session_id,
        "task": {
            "query": task.get("query"),
            "id": task.get("id"),
            "retrieved_tools_count": len(api_list)
        },
        "totalSteps": 0,
        "payloadLength": len(task.get("payload_str", req.payload)) if req.payload else 16 
    }


@router.post("/api/generate_title")
async def generate_title(req: GenerateTitleRequest):
    try:
        conversation_text = ""
        for turn in req.history[:6]:
            role = turn.get("role", "")
            content = turn.get("message") or turn.get("content") or ""
            if role == "user":
                conversation_text += f"User: {content}\n"
            elif role == "assistant":
                conversation_text += f"Assistant: {content}\n"
        
        if not conversation_text:
            return {"title": "New Conversation"}

        api_key = None
        if sessions:
            api_key = list(sessions.values())[0].client.api_key
        
        if not api_key:
             return {"title": "New Conversation (Untitled)"}

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
        
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "Generate a very concise title (3-6 words) for this conversation. Output ONLY the title, no quotes."},
                {"role": "user", "content": conversation_text}
            ],
            temperature=0.7,
            max_tokens=20
        )
        
        title = response.choices[0].message.content.strip().replace('"', '')
        return {"title": title}

    except Exception as e:
        print(f"[ERROR] Title generation failed: {e}")
        return {"title": "New Conversation"}


@router.post("/api/restore_session")
async def restore_session(req: RestoreSessionRequest):
    print(f"[INFO] Restore session request for scenarioId: {req.scenarioId}")
    
    data = db.get_conversation(req.scenarioId)
    
    if not data:
        print(f"[ERROR] Scenario {req.scenarioId} not found in database")
        raise HTTPException(status_code=404, detail="Saved scenario not found")
    
    session_id = f"sess_{int(time.time())}_{req.scenarioId}_restored"
    
    task = {
        "query": data.get("userQuery") or "Restored Task",
        "api_list": [],
        "id": req.scenarioId,
        "payload_str": data.get("payload") or "11001101"
    }
    
    api_key = resolve_api_key(req.apiKey)
    session = Session(session_id, api_key, task, task["payload_str"])
    
    watermarked_trajectory = []
    baseline_trajectory = []
    steps = data.get("steps", [])
    
    for step in steps:
        s_type = step.get("stepType", "thought")
        
        if s_type == "user_input":
            user_msg = {"role": "user", "message": step.get("thought") or step.get("action")}
            watermarked_trajectory.append(user_msg)
            baseline_trajectory.append(user_msg)
            
        elif s_type in ["thought", "finish", "tool"]:
            thought = step.get("thought", "")
            action = step.get("action", "")
            final_answer = step.get("finalAnswer")
            
            chosen_tool = "Finish"
            if action.startswith("Call: "):
                chosen_tool = action.replace("Call: ", "").strip()
            elif action == "Finish":
                chosen_tool = "Finish"
            
            model_out_dict = {
                "action": chosen_tool,
                "action_args": {},
                "thought": thought
            }
            
            if chosen_tool == "Finish" and final_answer:
                 model_out_dict["action_args"] = { "final_answer": final_answer }
            
            watermarked_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
            
            obs = step.get("toolDetails") or step.get("observation")
            if obs and chosen_tool != "Finish":
                watermarked_trajectory.append({"role": "tool", "message": obs})
            
            baseline_data = step.get("baseline")
            if baseline_data:
                baseline_thought = baseline_data.get("thought", "")
                baseline_action = baseline_data.get("action", "")
                baseline_final_answer = baseline_data.get("finalAnswer")
                
                baseline_tool = "Finish"
                if baseline_action.startswith("Call: "):
                    baseline_tool = baseline_action.replace("Call: ", "").strip()
                elif baseline_action == "Finish":
                    baseline_tool = "Finish"
                
                baseline_model_dict = {
                    "action": baseline_tool,
                    "action_args": {},
                    "thought": baseline_thought
                }
                
                if baseline_tool == "Finish" and baseline_final_answer:
                    baseline_model_dict["action_args"] = { "final_answer": baseline_final_answer }
                
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(baseline_model_dict)})
                
                baseline_obs = baseline_data.get("toolDetails") or baseline_data.get("observation")
                if baseline_obs and baseline_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": baseline_obs})
            else:
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
                if obs and chosen_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": obs})

    session.watermarked_state.trajectory = watermarked_trajectory
    session.baseline_state.trajectory = baseline_trajectory
    session.watermarked_state.step_count = len(steps)
    session.baseline_state.step_count = len(steps)
    
    sessions[session_id] = session
    
    return {
        "sessionId": session_id,
        "task": {
             "query": task["query"],
             "id": req.scenarioId
        },
        "restoredSteps": len(steps)
    }

@router.post("/api/continue")
async def continue_session(req: ContinueRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    retriever = get_retriever()

    print(f"\n[INFO] >>> RECEIVED CONTINUE PROMPT: '{req.prompt}' <<<\n")
    if retriever:
        new_tools = retriever.retrieve(req.prompt, top_k=5)
        if new_tools:
            print(f"[INFO] Retrieved {len(new_tools)} new tools for continuation.")
            
            def update_agent_tools(agent_state: AgentState):
                current_tools = agent_state.task.get("api_list", [])
                existing_names = {t.get("func_name") or t.get("api_name") for t in current_tools}
                
                for tool in new_tools:
                    t_name = tool.get("func_name") or tool.get("api_name")
                    if t_name not in existing_names:
                        current_tools.append(tool)
                        existing_names.add(t_name)
                
                agent_state.task["api_list"] = current_tools
                try:
                    updated_episode = agent_state.adapter.prepare_episode(agent_state.task)
                    agent_state.episode["tool_summaries"] = updated_episode["tool_summaries"]
                    agent_state.episode["admissible_commands"] = updated_episode["admissible_commands"]
                except Exception as e:
                    print(f"[ERROR] Failed to refresh episode context: {e}")

            update_agent_tools(sess.watermarked_state)
            update_agent_tools(sess.baseline_state)

    sess.watermarked_state.trajectory.append({"role": "user", "message": req.prompt})
    sess.baseline_state.trajectory.append({"role": "user", "message": req.prompt})
    
    sess.max_steps += 10
    
    sess.watermarked_state.done = False
    sess.baseline_state.done = False
    
    return {"status": "success", "message": "Session continued", "new_max_steps": sess.max_steps}


@router.post("/api/step")
async def step_session(req: StepRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    if sess.watermarked_state.step_count >= sess.max_steps:
        # Return immediate JSON (simplified)
        async def immediate_done():
            metrics = {"latency": 0.0, "tokens": 0.0}
            yield json.dumps({
                "type": "result",
                "data": {
                    "agent": "watermarked",
                    "done": True, "thought": "Max steps reached", "action": "Finish", "distribution": [],
                    "metrics": metrics
                }
            }) + "\n"
            yield json.dumps({
                 "type": "result",
                 "data": {
                     "agent": "baseline",
                     "done": True, "thought": "Max steps reached", "action": "Finish", "distribution": [],
                     "metrics": metrics
                 }
            }) + "\n"
        return StreamingResponse(immediate_done(), media_type="application/x-ndjson")

    async def step_single_agent(
        agent_state: AgentState,
        is_watermarked: bool,
        output_queue: asyncio.Queue,
        *,
        mirror_agent: Optional[str] = None
    ):
        step_start_time = time.time()
        
        # Initialize tokenizer (cl100k_base is used by gpt-4, gpt-3.5, and deepseek)
        try:
            encoding = tiktoken.get_encoding("cl100k_base")
        except Exception:
            encoding = None
        
        if agent_state.done:
             # Return empty/done state
             return {
                 "agent": agent_state.role, "thought": "", "action": "Finish", "done": True,
                  "final_answer": "", "distribution": [], "metrics": {"latency": 0.0, "tokens": 0.0}
             }, ({"bits":"", "matrixRows":[], "rankContribution":0} if is_watermarked else None), 0, None

        # Build messages
        messages = build_messages(
            query=agent_state.task.get("query", ""),
            tool_summaries=agent_state.episode["tool_summaries"],
            admissible_commands=agent_state.episode["admissible_commands"]
        )
        for turn in agent_state.trajectory:
            if turn["role"] == "assistant":
                 messages.append({"role": "assistant", "content": turn["message"]})
            elif turn["role"] == "tool":
                 messages.append({"role": "user", "content": f"Observation:\n{turn['message']}\nContinue Thought/Action/Action Input."})
            elif turn["role"] == "user":
                 messages.append({"role": "user", "content": turn["message"]})

        model_output = ""
        try:
            response_stream = await sess.async_client.chat.completions.create(
                model=sess.model, 
                messages=messages,
                temperature=0.0,
                max_tokens=512,
                stream=True,
                stream_options={"include_usage": True}
            )
            async for chunk in response_stream:
                # Handle usage chunk (usually the last one if stream_options is set)
                if hasattr(chunk, "usage") and chunk.usage:
                    print(f"[DEBUG] API Usage Captured: {chunk.usage.total_tokens}")
                    agent_state.last_tokens = float(chunk.usage.total_tokens)

                if not chunk.choices:
                    continue
                
                content = chunk.choices[0].delta.content
                if content:
                    model_output += content
                    await output_queue.put({
                        "type": "thought",
                        "agent": agent_state.role,
                        "content": content
                    })
                    if mirror_agent:
                         await output_queue.put({
                            "type": "thought",
                            "agent": mirror_agent,
                            "content": content
                        })
        except Exception as e:
            print(f"[ERROR] Agent Error: {e}")
            model_output = json.dumps({"action": "Finish", "thought": "Error occurred", "action_args":{"final_answer": "Error"}})

        probs = extract_and_normalize_probabilities(model_output, agent_state.episode["admissible_commands"])
        if not probs:
            probs = uniform_prob(agent_state.episode["admissible_commands"])
            
        chosen = "Finish"
        consumed_bits = 0
        watermark_info = None
        
        if is_watermarked:
             chunk_length = 64
             rlnc_chunk = sess.rlnc.get_stream(start_index=sess.bit_index, length=chunk_length)
             
             chosen, target_list, consumed_bits, context_used = sample_behavior_differential(
                probabilities=probs,
                bit_stream=rlnc_chunk,
                bit_index=0,
                context_for_key=agent_state.last_observation,
                round_num=agent_state.step_count
             )
             
             # Build matrix rows for RLNC visualization
             matrix_rows = []
             if consumed_bits > 0:
                 # Generate the coefficient vector for this packet
                 # Each received bit corresponds to an RLNC equation
                 for i in range(consumed_bits):
                     bit_global_idx = sess.bit_index + i
                     coeffs = sess.rlnc._generate_coeffs(bit_global_idx)
                     matrix_rows.append(coeffs)
             
             watermark_info = {
                 "bits": rlnc_chunk[:consumed_bits] if consumed_bits > 0 else "",
                 "matrixRows": matrix_rows,
                 "rankContribution": 1 if consumed_bits > 0 else 0
             }
        else:
             if probs:
                chosen = max(probs.items(), key=lambda x: x[1])[0]
        
        action_args = parse_action_args_from_output(model_output, chosen)
        
        # Tool Execution
        obs = ""
        done = False
        final_answer = ""
        
        if chosen == "Finish":
            done = True
            final_answer = action_args.get("final_answer", "")
            
            # Fallback 1: Regex extraction (handles malformed JSON)
            if not final_answer:
                match = re.search(r'"final_answer"\s*:\s*"((?:\\.|[^"\\])*)"', model_output, re.DOTALL)
                if match:
                    try:
                         # Attempt to use JSON loader to handle escapes correctly
                         candidate = match.group(1)
                         final_answer = json.loads(f'"{candidate}"')
                    except:
                         # Fallback manual unescape
                         final_answer = match.group(1).replace('\\n', '\n').replace('\\"', '"')

            # Fallback 2: If still empty, use thought
            if not final_answer:
                thought_content = extract_thought_from_raw_output(model_output)
                if thought_content:
                    final_answer = thought_content
            
            # Update trajectory with the actual final answer we found
            action_args_to_save = action_args.copy()
            if not action_args_to_save.get("final_answer") and final_answer:
                 action_args_to_save["final_answer"] = final_answer
            
            print(f"[DEBUG][Finish] action_args={action_args}, final_answer='{final_answer[:100] if final_answer else 'EMPTY'}...'")
            print(f"[DEBUG][Finish] RAW model_output={model_output[:1000]}...") # Print first 1000 chars

            # Save raw content for debugging
            msg_payload = {"action": "Finish", "thought": "Finished", "action_args": action_args_to_save, "raw_content": model_output}
            agent_state.trajectory.append({"role": "assistant", "message": json.dumps(msg_payload)})
        else:
             # Execute Tool
             tool_def = next((t for t in agent_state.episode["tool_summaries"] if t["name"] == chosen), None)
             if tool_def:
                 extracted_thought = extract_thought_from_raw_output(model_output)
                 agent_state.trajectory.append({"role": "assistant", "message": json.dumps({"action": chosen, "thought": extracted_thought, "action_args": action_args}, ensure_ascii=False)})
                 
                 # Using adapter to execute
                 # We need to construct action object
                 action_obj = {"tool": chosen, "arguments": action_args}
                 try:
                     obs_result = agent_state.adapter.step(
                         action_obj,
                         agent_state.episode["tool_summaries"],
                         state=agent_state.task
                     )
                     obs = obs_result["observation"]
                 except Exception as e:
                     obs = f"Error executing tool: {e}"
                 
                 agent_state.trajectory.append({"role": "tool", "message": obs})
                 agent_state.last_observation = obs
             else:
                 # Tool not found, maybe halluncinated
                 agent_state.trajectory.append({"role": "assistant", "message": json.dumps({"action": chosen, "thought": "Unknown tool"})})
                 obs = "Tool not found or invalid."
                 agent_state.trajectory.append({"role": "tool", "message": obs})

        agent_state.done = done
        agent_state.step_count += 1
        
        step_latency = time.time() - step_start_time
        
        # Token Calculation (Local precise counting if API doesn't provide)
        tokens_used = getattr(agent_state, "last_tokens", 0.0)
        if tokens_used <= 0 and encoding:
            # Calculate input tokens
            input_text = json.dumps(messages, ensure_ascii=False)
            input_tokens = len(encoding.encode(input_text))
            # Calculate output tokens
            output_tokens = len(encoding.encode(model_output))
            tokens_used = float(input_tokens + output_tokens)
        elif tokens_used <= 0:
            # Very unlikely fallback if tiktoken fails
            prompt_chars = len(json.dumps(messages))
            output_chars = len(model_output)
            tokens_used = (prompt_chars + output_chars) / 4.0
        
        # DEBUG: Write to file
        try:
            with open(str(PROJECT_ROOT / "dashboard/server/token_debug.log"), "a") as f:
                f.write(f"Agent: {agent_state.role}, Step: {agent_state.step_count}, Tokens: {tokens_used}, LastAPI: {getattr(agent_state, 'last_tokens', 'N/A')}\n")
        except:
            pass

        final_data = {
            "agent": agent_state.role,
            "thought": extract_thought_from_raw_output(model_output),
            "action": f"Call: {chosen}" if chosen != "Finish" else "Finish",
            "observation": obs,
            "done": done,
            "final_answer": final_answer,
            "distribution": [{"name": k, "prob": v, "isSelected": k==chosen} for k,v in probs.items()],
            "stepIndex": agent_state.step_count - 1,
            "metrics": {"latency": step_latency, "tokens": tokens_used}
        }
        
        return final_data, watermark_info, consumed_bits, None


    async def event_generator():
        output_queue = asyncio.Queue()
        
        wm_task = asyncio.create_task(step_single_agent(sess.watermarked_state, True, output_queue))
        bl_task = asyncio.create_task(step_single_agent(sess.baseline_state, False, output_queue))
        
        # We need to wait for both tasks, but also consume queue meanwhile
        # Actually this approach is tricky with streaming output from both concurrently
        # For simplicity, we can let them run and consume queue until both done.
        
        pending = [wm_task, bl_task]
        
        while pending:
            # Wait for queue item or task completion
            # Create a task for queue.get()
            queue_task = asyncio.create_task(output_queue.get())
            done_set, pending_set = await asyncio.wait(pending + [queue_task], return_when=asyncio.FIRST_COMPLETED)
            
            if queue_task in done_set:
                 # Yield queue item
                 item = queue_task.result()
                 yield json.dumps(item) + "\n"
                 # Re-add tasks to pending if they are not done (filtering happens via logic below)
            else:
                 # One of the agent tasks finished
                 queue_task.cancel() # Cancel waiting for queue
            
            # Update pending list
            new_pending = []
            for t in pending:
                if t in done_set:
                     # Task finished, get result and yield "result" type
                     try:
                         result_data, wm_data, bits, shared = t.result()
                         yield json.dumps({
                             "type": "result", 
                             "data": {**result_data, "watermark": wm_data}
                         }) + "\n"
                         
                         if result_data["agent"] == "watermarked" and bits > 0:
                             sess.bit_index += bits
                     except Exception as e:
                         print(f"Step failed: {e}")
                else:
                    new_pending.append(t)
            pending = new_pending
            
            # Drain queue if tasks finished but queue still has items?
            # Ideally tasks put to queue then finish.
            while not output_queue.empty():
                 item = output_queue.get_nowait()
                 yield json.dumps(item) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/api/evaluate")
async def evaluate_session(req: EvaluateRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    # helper to format
    def format_traj(traj):
        out = []
        for t in traj:
            role = t.get("role", "unknown")
            msg = t.get("message", "")
            if role == "assistant":
                try:
                    d = json.loads(msg)
                    th = d.get("thought", "")
                    ac = d.get("action", "")
                    arg = d.get("action_args", {})
                    line = f"Thought: {th}\nAction: {ac}"
                    if arg:
                        line += f"\nArgs: {json.dumps(arg, ensure_ascii=False)}"
                    out.append(f"[Assistant]\n{line}")
                except:
                    out.append(f"[Assistant]\n{msg}")
            elif role == "tool":
                out.append(f"[Tool Output]\n{msg[:500]}..." if len(msg) > 500 else f"[Tool Output]\n{msg}")
            else:
                out.append(f"[{role.capitalize()}]\n{msg}")
        return "\n\n".join(out)

    traj_a = format_traj(sess.watermarked_state.trajectory)
    traj_b = format_traj(sess.baseline_state.trajectory)
    
    prompt = f"""You are an expert judge evaluating two AI agents.
Task: {sess.watermarked_state.task.get('query', 'Unknown')}

=== Agent A (Watermarked) ===
{traj_a}

=== Agent B (Baseline) ===
{traj_b}

Evaluate them on:
1. Success: Did they solve it?
2. Efficiency: Who used fewer steps/tools?
3. Safety/Correctness.

Output JSON ONLY:
{{
    "model_a_score": <0-10>,
    "model_b_score": <0-10>,
    "reason": "Concise explanation in {req.language}"
}}
"""

    try:
        resp = await sess.async_client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.0
        )
        content = resp.choices[0].message.content
        result = json.loads(content)
        sess.evaluation_result = result
        return result
    except Exception as e:
        print(f"[ERROR] Evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
