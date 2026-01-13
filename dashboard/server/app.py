
import json
import uuid
import time
import os
import asyncio
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI, AsyncOpenAI
from sentence_transformers import SentenceTransformer, util
import copy
# --- Configuration ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
TOOL_DATA_ROOT = PROJECT_ROOT / "experiments/toolbench/data/data/toolenv/tools"

import sys
sys.path.append(str(PROJECT_ROOT))

from agentmark.core.rlnc_codec import DeterministicRLNC
from agentmark.core.watermark_sampler import sample_behavior_differential

# --- Database Setup ---
from dashboard.server.database import ConversationDB
db = ConversationDB(db_path=str(PROJECT_ROOT / "dashboard/data/conversations.db"))

# --- Retriever Setup ---
from dashboard.server.retriever import ToolBenchRetriever
# from retriever import ToolBenchRetriever # If running from server dir? 
# Better use relative or absolute if path is set.
# Since app.py is in dashboard/server, 'import retriever' works if CWD is dashboard/server OR if dashboard/server is in path.
# But we run from root usually.
# If we run `python dashboard/server/app.py`, sys.path[0] is dashboard/server. So `import retriever` works.
# But `agentmark` needs root in path.

from agentmark.environments.toolbench.adapter import ToolBenchAdapter
retriever = None
retriever_loading = False

async def init_retriever():
    global retriever, retriever_loading
    retriever_loading = True
    print("[INFO] Background: Initializing ToolBench Retriever on CPU...")
    try:
        # Run in thread to avoid blocking simple init
        r = await asyncio.to_thread(ToolBenchRetriever, TOOL_DATA_ROOT, device="cpu")
        await asyncio.to_thread(r.load_model)
        await asyncio.to_thread(r.index_tools)
        retriever = r
        print("[INFO] Background: Retriever Ready.")
    except Exception as e:
        print(f"[ERROR] Background Retriever Init Failed: {e}")
    finally:
        retriever_loading = False

# --- App Setup ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    print("[INFO] Initializing ToolBench Retriever...")
    asyncio.create_task(init_retriever())


# --- Simulation State ---

class AgentState:
    """Encapsulates the state for a single agent (Baseline or Watermarked)"""
    def __init__(self, task_data: Dict, role: str):
        self.role = role # 'baseline' or 'watermarked'
        self.task = copy.deepcopy(task_data) # Deep copy to ensure independent modification
        
        # ToolBench Adapter State
        # For this demo, we use a simplified Adapter relying on LLM to propose JSON
        self.adapter = ToolBenchAdapter(TOOL_DATA_ROOT)
        self.episode = self.adapter.prepare_episode(self.task)
        
        # Execution History
        self.trajectory = [] # List of {role, message}
        self.step_count = 0
        self.last_observation = ""
        self.done = False

class Session:
    def __init__(self, session_id: str, api_key: str, task_data: Dict, payload: str = "1101"):
        self.session_id = session_id
        self.start_time = time.time()
        
        # Common Config
        self.max_steps = 15
        
        # Agent States
        self.watermarked_state = AgentState(task_data, 'watermarked')
        self.baseline_state = AgentState(task_data, 'baseline')
        
        # Payload / Watermark State (Only for watermarked agent)
        self.bit_stream_str_raw = payload if payload else "1101" # Keep raw for reference
        # Initialize RLNC
        self.rlnc = DeterministicRLNC(self.bit_stream_str_raw)
        self.bit_index = 0
        
        # LLM Client
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
        self.async_client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
        self.model = "deepseek-chat"
        self.evaluation_result = None # Store evaluation result

sessions: Dict[str, Session] = {}

class InitRequest(BaseModel):
    apiKey: str
    scenarioId: str
    payload: Optional[str] = None

class CustomInitRequest(BaseModel):
    apiKey: str
    query: str
    payload: Optional[str] = None

class StepRequest(BaseModel):
    sessionId: str

class ContinueRequest(BaseModel):
    sessionId: str
    prompt: str

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

def extract_and_normalize_probabilities(output: str, candidates: List[str]) -> Dict[str, float]:
    # DeepSeek chat API doesn't expose logprobs in this demo.
    # We therefore:
    #   1) Prefer model-provided `action_weights` if present (normalized).
    #   2) Otherwise, fall back to a biased-but-non-degenerate distribution (multiple "steps"),
    #      to avoid the "one huge + many identical tiny" shape that collapses bins in the UI.

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
        # Biased-but-non-degenerate distribution: top_action gets fixed mass,
        # the rest get a geometric decay so p2>p3>... (no flat plateau).
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

@app.post("/api/init")
async def init_session(req: InitRequest):
    session_id = f"sess_{int(time.time())}_{req.scenarioId}"
    
    # Load Scenario Data
    # In a real app, this would load from disk/db. 
    # We will use the 'retriever' to find tools for the query if scenario query is custom?
    # For fixed scenarios, we might already have the tool list. 
    # Let's assume we retrieve dynamically for "Live" demo always, or use cached.
    
    task = {
        "query": "Solve task " + req.scenarioId, 
        "api_list": [], # Will be empty, adapter handles fallback or we retrieve
        "id": req.scenarioId,
        "payload_str": req.payload 
    }
    
    # Try retrieve real tools if we know the query? 
    # For now, start empty or basic.
    
    session = Session(session_id, req.apiKey, task, req.payload)
    sessions[session_id] = session
    
    print(f"[INFO] Session {session_id} initialized with Payload: '{task['payload_str']}'")
    
    return {
        "sessionId": session_id,
        "task": {
            "query": task.get("query"),
            "id": req.scenarioId
        },
        "totalSteps": 0, # Start
        "payloadLength": len(req.payload) if req.payload else 16
    }

@app.post("/api/init_custom")
async def init_custom_session(req: CustomInitRequest):
    session_id = f"sess_{int(time.time())}_custom"
    
    print(f"\n[INFO] >>> RECEIVED CUSTOM PROMPT: '{req.query}' <<<")
    
    api_list = []
    if retriever_loading:
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
    
    session = Session(session_id, req.apiKey, task, req.payload)
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

# --- Scenario Persistence ---

@app.get("/api/scenarios")
async def list_scenarios(search: Optional[str] = None, limit: int = 100):
    """List all saved conversations from database with optional search"""
    try:
        scenarios = db.list_conversations(limit=limit, search=search)
        return scenarios
    except Exception as e:
        print(f"[ERROR] Failed to list scenarios: {e}")
        return []

class SaveScenarioRequest(BaseModel):
    title: Any # str or dict
    data: Dict
    id: Optional[str] = None # Optional ID to overwrite

@app.post("/api/save_scenario")
async def save_scenario(req: SaveScenarioRequest):
    """Save conversation to database"""
    try:
        scenario_id = req.id if req.id else str(uuid.uuid4())
        
        scenario_data = req.data
        scenario_data["id"] = scenario_id
        
        # Handle title format
        if isinstance(req.title, str):
            scenario_data["title"] = {"en": req.title, "zh": req.title}
        else:
            scenario_data["title"] = req.title
        
        # Save to database
        db.save_conversation(scenario_data)
        
        print(f"[INFO] Saved scenario {scenario_id} to database")
        return {"status": "success", "id": scenario_id}
    except Exception as e:
        print(f"[ERROR] Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/scenarios/{scenario_id}")
async def delete_scenario(scenario_id: str):
    """Delete a conversation from database"""
    try:
        deleted = db.delete_conversation(scenario_id)
        if deleted:
            print(f"[INFO] Deleted scenario {scenario_id} from database")
            return {"status": "success", "id": scenario_id}
        else:
            raise HTTPException(status_code=404, detail="Scenario not found")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class GenerateTitleRequest(BaseModel):
    history: List[Dict] # List of {role, content/message}

@app.post("/api/generate_title")
async def generate_title(req: GenerateTitleRequest):
    try:
        # Extract user messages to summarize
        # Limit to first few turns for title generation
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

        # Use a quick call to generate title
        # We can use the same client
        # Create a temporary client if needed, or reuse one from a session if available?
        # We don't have a session ID here necessarily.
        # But we initialized 'sessions' with keys. We can just instantiate a generic client.
        # However, to avoid global client init if not needed, we can just pick one active session or init a temporary one.
        # OR better: init a global client for utility tasks.
        
        # NOTE: In this demo, we assume we have an API Key.
        # But this request comes from frontend. Does it have API Key?
        # The frontend might not pass API key here if it's "auto save".
        # We should ideally pass API Key in request or reuse global environment variable.
        # For this demo, let's assume we reuse a valid API key from any active session or environment.
        # If no active session, we might fail.
        # Let's check if we have any active session to steal credentials or use a default if configured.
        
        api_key = None
        if sessions:
            api_key = list(sessions.values())[0].client.api_key
        
        if not api_key:
             return {"title": "New Conversation (Untitled)"}

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



def uniform_prob(commands: List[str]) -> Dict[str, float]:
    p = 1.0 / len(commands) if commands else 0
    return {c: p for c in commands}

class RestoreSessionRequest(BaseModel):
    apiKey: str
    scenarioId: str

@app.post("/api/restore_session")
async def restore_session(req: RestoreSessionRequest):
    """Restore session from database"""
    print(f"[INFO] Restore session request for scenarioId: {req.scenarioId}")
    
    # 1. Load saved scenario from database
    data = db.get_conversation(req.scenarioId)
    
    if not data:
        print(f"[ERROR] Scenario {req.scenarioId} not found in database")
        # List all available conversations for debugging
        all_convs = db.list_conversations(limit=10)
        print(f"[INFO] Available conversations: {[c['id'] for c in all_convs]}")
        raise HTTPException(status_code=404, detail="Saved scenario not found")
    
    print(f"[INFO] Found scenario in database: {data.get('id')}, steps: {len(data.get('steps', []))}")

    # 2. Init Session
    session_id = f"sess_{int(time.time())}_{req.scenarioId}_restored"
    
    # Extract task details from saved data
    # Saved data has 'steps', 'userQuery', etc.
    task = {
        "query": data.get("userQuery") or "Restored Task",
        "api_list": [], # We will rely on retrieval for next steps or assume stateless
        "id": req.scenarioId,
        "payload_str": data.get("payload") or "11001101"
    }
    
    # 3. Create Session
    session = Session(session_id, req.apiKey, task, task["payload_str"])
    
    # 4. Reconstruct Trajectory from Steps
    # This is "best effort" mapping from UI-steps to internal-trajectory
    # UI Step Types: 'user_input', 'thought' (with action/tool), 'tool', 'finish'
    
    watermarked_trajectory = []
    baseline_trajectory = []
    
    steps = data.get("steps", [])
    
    # We need to map steps to (User, Assistant, Tool) messages.
    # Logic:
    # - if stepType == 'user_input': -> User Message
    # - if stepType == 'thought' or 'finish': -> Assistant Message (reconstruct JSON)
    # - if stepType == 'tool': -> Tool Message (Observation)
    
    # Let's iterate and reconstruct
    for step in steps:
        s_type = step.get("stepType", "thought")
        
        if s_type == "user_input":
            # User messages are the same for both agents
            user_msg = {"role": "user", "message": step.get("thought") or step.get("action")}
            watermarked_trajectory.append(user_msg)
            baseline_trajectory.append(user_msg)
            
        elif s_type in ["thought", "finish", "tool"]:
            # Reconstruct Watermarked Agent's messages
            thought = step.get("thought", "")
            action = step.get("action", "")
            final_answer = step.get("finalAnswer")
            
            # Helper to parse "Call: ToolName" -> ToolName
            chosen_tool = "Finish"
            if action.startswith("Call: "):
                chosen_tool = action.replace("Call: ", "").strip()
            elif action == "Finish":
                chosen_tool = "Finish"
            
            # Reconstruct Dict for watermarked agent
            model_out_dict = {
                "action": chosen_tool,
                "action_args": {},
                "thought": thought
            }
            
            if chosen_tool == "Finish" and final_answer:
                 model_out_dict["action_args"] = { "final_answer": final_answer }
            
            # Store as string (mocking the LLM raw output)
            watermarked_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
            
            # Add observation for watermarked agent
            obs = step.get("toolDetails") or step.get("observation")
            if obs and chosen_tool != "Finish":
                watermarked_trajectory.append({"role": "tool", "message": obs})
            
            # Reconstruct Baseline Agent's messages (if exists)
            baseline_data = step.get("baseline")
            if baseline_data:
                baseline_thought = baseline_data.get("thought", "")
                baseline_action = baseline_data.get("action", "")
                baseline_final_answer = baseline_data.get("finalAnswer")
                
                # Parse baseline action
                baseline_tool = "Finish"
                if baseline_action.startswith("Call: "):
                    baseline_tool = baseline_action.replace("Call: ", "").strip()
                elif baseline_action == "Finish":
                    baseline_tool = "Finish"
                
                # Reconstruct Dict for baseline agent
                baseline_model_dict = {
                    "action": baseline_tool,
                    "action_args": {},
                    "thought": baseline_thought
                }
                
                if baseline_tool == "Finish" and baseline_final_answer:
                    baseline_model_dict["action_args"] = { "final_answer": baseline_final_answer }
                
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(baseline_model_dict)})
                
                # Add observation for baseline agent
                baseline_obs = baseline_data.get("toolDetails") or baseline_data.get("observation")
                if baseline_obs and baseline_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": baseline_obs})
            else:
                # If no baseline data, copy watermarked data
                baseline_trajectory.append({"role": "assistant", "message": json.dumps(model_out_dict)})
                if obs and chosen_tool != "Finish":
                    baseline_trajectory.append({"role": "tool", "message": obs})

    # Hydrate both agents with their respective trajectories
    session.watermarked_state.trajectory = watermarked_trajectory
    session.baseline_state.trajectory = baseline_trajectory
    
    # Set step count
    session.watermarked_state.step_count = len(steps)
    session.baseline_state.step_count = len(steps)
    
    # Store session
    sessions[session_id] = session
    
    print(f"[INFO] Restored session {session_id} with {len(watermarked_trajectory)} watermarked turns and {len(baseline_trajectory)} baseline turns.")
    print(f"[INFO] Session stored in sessions dict. Total sessions: {len(sessions)}")
    print(f"[INFO] Session keys: {list(sessions.keys())}")
    
    return {
        "sessionId": session_id,
        "task": {
             "query": task["query"],
             "id": req.scenarioId
        },
        "restoredSteps": len(steps)
    }

@app.post("/api/continue")
async def continue_session(req: ContinueRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    # Retrieve new tools for the continuation prompt
    print(f"\n[INFO] >>> RECEIVED CONTINUE PROMPT: '{req.prompt}' <<<\n")
    if retriever:
        new_tools = retriever.retrieve(req.prompt, top_k=5)
        if new_tools:
            print(f"[INFO] Retrieved {len(new_tools)} new tools for continuation.")
            
            # Helper to update agent state with new tools
            def update_agent_tools(agent_state: AgentState):
                # Basic dedup check
                current_tools = agent_state.task.get("api_list", [])
                existing_names = {t.get("func_name") or t.get("api_name") for t in current_tools}
                
                for tool in new_tools:
                    t_name = tool.get("func_name") or tool.get("api_name")
                    if t_name not in existing_names:
                        current_tools.append(tool)
                        existing_names.add(t_name)
                
                agent_state.task["api_list"] = current_tools
                
                # CRITICAL: Re-initialize episode to refresh tool summaries and admissible commands
                try:
                    updated_episode = agent_state.adapter.prepare_episode(agent_state.task)
                    agent_state.episode["tool_summaries"] = updated_episode["tool_summaries"]
                    agent_state.episode["admissible_commands"] = updated_episode["admissible_commands"]
                except Exception as e:
                    print(f"[ERROR] Failed to refresh episode context for {agent_state.role}: {e}")

            # Update both agents
            update_agent_tools(sess.watermarked_state)
            update_agent_tools(sess.baseline_state)
            print("[INFO] Updated tools for both agents.")
            
    
    # Append user prompt to trajectory for both
    sess.watermarked_state.trajectory.append({"role": "user", "message": req.prompt})
    sess.baseline_state.trajectory.append({"role": "user", "message": req.prompt})
    
    # Extend max steps to allow continuation
    sess.max_steps += 10
    
    # CRITICAL: Reset done state so agents continue
    sess.watermarked_state.done = False
    sess.baseline_state.done = False
    
    return {"status": "success", "message": "Session continued", "new_max_steps": sess.max_steps}

@app.post("/api/step")
async def step_session(req: StepRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    if sess.watermarked_state.step_count >= sess.max_steps:
        # Return immediate JSON for consistency if done
        def immediate_done():
            yield json.dumps({
                "type": "result",
                "data": {
                    "agent": "watermarked",
                    "done": True,
                    "thought": "Max steps reached",
                    "action": "Finish",
                    "observation": "",
                    "final_answer": "",
                    "distribution": [],
                    "metrics": {"latency": 0.0, "tokens": 0.0},
                },
            }) + "\n"
            yield json.dumps({
                "type": "result",
                "data": {
                    "agent": "baseline",
                    "done": True,
                    "thought": "Max steps reached",
                    "action": "Finish",
                    "observation": "",
                    "final_answer": "",
                    "distribution": [],
                    "metrics": {"latency": 0.0, "tokens": 0.0},
                },
            }) + "\n"
        return StreamingResponse(immediate_done(), media_type="application/x-ndjson")

    # --- Generic Single Agent Step Function ---
    async def step_single_agent(agent_state: AgentState, is_watermarked: bool, output_queue: asyncio.Queue):
        step_start_time = time.time()
        
        # Check done state
        if agent_state.done:
            final_data = {
                "agent": agent_state.role,
                "thought": "",
                "action": "Finish",
                "observation": "",
                "done": True,
                "final_answer": "",
                "distribution": [],
                "metrics": {
                    "latency": 0.0,
                    "tokens": 0.0,
                },
            }

            if is_watermarked:
                watermark_data = {
                    "bits": "",
                    "matrixRows": [],
                    "rankContribution": 0,
                }
                return final_data, watermark_data, 0

            return final_data, None, 0

        # 1. Build Messages
        messages = build_messages(
            query=agent_state.task.get("query", ""),
            tool_summaries=agent_state.episode["tool_summaries"],
            admissible_commands=agent_state.episode["admissible_commands"]
        )
        # Add history
        for turn in agent_state.trajectory:
            if turn["role"] == "assistant":
                 messages.append({"role": "assistant", "content": turn["message"]})
            elif turn["role"] == "tool":
                 # Simulate tool output as user message (ToolBench style)
                 messages.append({"role": "user", "content": f"Observation:\n{turn['message']}\nContinue Thought/Action/Action Input."})
            elif turn["role"] == "user":
                 messages.append({"role": "user", "content": turn["message"]})

        # 2. Call LLM
        model_output = ""
        try:
            print(f"[DEBUG] Call LLM ({agent_state.role})")
            # ENABLE STREAMING
            response_stream = await sess.async_client.chat.completions.create(
                model=sess.model, 
                messages=messages,
                temperature=0.0,
                max_tokens=512,
                stream=True 
            )
            
            async for chunk in response_stream:
                content = chunk.choices[0].delta.content
                if content:
                    model_output += content
                    # Stream thought chunk
                    # We assume everything is thought until we parse it fully later, or we just stream raw text.
                    # Ideally we would only stream if it's NOT inside a JSON structure, but for "Thinking...", 
                    # showing the raw generation is fine and "hacky" but works for visual effect.
                    await output_queue.put({
                        "type": "thought",
                        "agent": agent_state.role,
                        "content": content
                    })

        except Exception as e:
            print(f"[ERROR] Step Model Error ({agent_state.role}): {e}")
            model_output = json.dumps({
                "action_weights": uniform_prob(agent_state.episode["admissible_commands"]),
                "action_args": {},
                "thought": "API Call Failed. Using fallback."
            })

        # 3. Process Result
        probs = extract_and_normalize_probabilities(model_output, agent_state.episode["admissible_commands"])
        if not probs:
            probs = uniform_prob(agent_state.episode["admissible_commands"])
            
        effective_probs = probs.copy() 
        
        chosen = "Finish"
        consumed_bits = 0
        
        # Sampling Strategy
        if is_watermarked:
            # Differential Sampling
            bit_before = sess.bit_index
            
            # 1. Fetch chunk from RLNC
            # We need enough bits for the sampler. The sampler typically consumes log2(N) bits, plus potentially more.
            # Let's fetch a safe chunk of 64 bits from the infinite stream
            # The sampler takes specific # of bits.
            # Ideally the sampler should take the stream object or we guess.
            # Our `sample_behavior_differential` implementation takes `bit_stream` as string.
            # We generate a chunk of 64 bits starting at bit_index.
            
            chunk_length = 64
            rlnc_chunk = sess.rlnc.get_stream(start_index=sess.bit_index, length=chunk_length)
            
            # 2. Call Real Sampler
            # Note: The real sampler signature is:
            # sample_behavior_differential(probabilities, bit_stream, bit_index, context_for_key=None, history_responses=None, seed=None, round_num=0)
            # IMPORTANT: The `bit_index` arg in sampler acts as an offset into the passed `bit_stream`.
            # Since we pass a fresh chunk, we should pass index 0 to the sampler, OR pass the full virtual stream?
            # Passing full virtual stream is impossible.
            # We pass the chunk, and tell sampler index is 0 relative to chunk.
            
            chosen, target_list, consumed_bits, context_used = sample_behavior_differential(
                probabilities=effective_probs,
                bit_stream=rlnc_chunk,
                bit_index=0, # relative to chunk
                context_for_key=agent_state.last_observation, # context
                round_num=agent_state.step_count
            )
            
            # consumed_bits is how many bits from chunk were used.
            # sess.bit_index += consumed_bits (Done below)

        else:
            # Baseline: Max Prob (Greedy) or simple Random
            # Greedy for stability
            if effective_probs:
                chosen = max(effective_probs.items(), key=lambda x: x[1])[0]
            else:
                 chosen = "Finish"

        # Parse Action Args
        try:
            start = model_output.find("{")
            end = model_output.rfind("}")
            json_str = model_output[start:end+1] if start != -1 else "{}"
            data = json.loads(json_str)
            action_args = {}
            if "action_args" in data:
                raw_args = data["action_args"]
                if isinstance(raw_args, dict) and chosen in raw_args:
                     action_args = raw_args[chosen]
                else:
                     action_args = raw_args
        except:
            action_args = {}

        action_obj = {"tool": chosen, "arguments": action_args}
        
        # Update History
        agent_state.trajectory.append({"role": "assistant", "message": model_output})
        
        # Thought Extraction
        thought = ""
        if "Thought:" in model_output:
            thought = model_output.split("Thought:")[1].split("{")[0].strip()
        elif "thought:" in model_output:
             thought = model_output.split("thought:")[1].split("{")[0].strip()
        else:
            parts = model_output.split("{", 1)
            if len(parts) > 1 and parts[0].strip():
                thought = parts[0].strip().replace("```json", "").replace("```", "").strip()
            else:
                try:
                    start = model_output.find("{")
                    end = model_output.rfind("}")
                    if start != -1 and end != -1:
                       json_str = model_output[start:end+1]
                       data = json.loads(json_str)
                       thought = data.get("thought", "")
                except:
                    pass
        
        # Fallback: if thought is still empty but we have content
        if not thought and model_output.strip() and not model_output.strip().startswith("{"):
             # Just take the text before the first brace
             thought = model_output.split("{")[0].strip()

        # Extract Final Answer
        final_answer_text = ""
        if chosen == "Finish":
            print(f"\n[DEBUG] RAW MODEL OUTPUT (Finish): {model_output}\n")
            if isinstance(action_args, dict):
                final_answer_text = action_args.get("final_answer", "")
            elif isinstance(action_args, str):
                final_answer_text = action_args
            
            # Fallback text extraction for final answer if JSON failed
            if not final_answer_text:
                import re
                try:
                    # Try to find "Final Answer:" pattern
                    fa_match = re.search(r"Final Answer:\s*(.*)", model_output, re.IGNORECASE | re.DOTALL)
                    if fa_match:
                         final_answer_text = fa_match.group(1).strip()
                except:
                    pass
            
            # If thought is empty but we have final answer, use final answer as thought for display if needed
            # if not thought and final_answer_text:
            #     thought = "Task Completed." 

        # Execute Tool
        step_result_obs = await asyncio.to_thread(agent_state.adapter.step, action_obj, agent_state.episode["tool_summaries"], state=agent_state.task)
        observation = step_result_obs["observation"]
        done = step_result_obs.get("done", False) or chosen == "Finish"
        
        agent_state.trajectory.append({"role": "tool", "message": observation})
        agent_state.last_observation = observation
        agent_state.step_count += 1
        agent_state.done = done

        # Prepare Result Dict
        obs_display = observation
        if not done and len(observation) > 200:
            obs_display = observation[:200] + "..."

        step_latency = time.time() - step_start_time
        est_tokens = len(model_output) / 4 
        
        # Decide default thought
        default_thought = "Thinking..." if not done else ""
        
        final_data = {
            "agent": agent_state.role, # 'watermarked' or 'baseline'
            "thought": thought or default_thought,
            "action": f"Call: {chosen}",
            "observation": obs_display,
            "done": done,
            "final_answer": final_answer_text, # Explicitly send final answer
            "distribution": [{"name": k, "prob": v, "isSelected": k==chosen} for k, v in probs.items()],
            "stepIndex": agent_state.step_count - 1,
            "metrics": {
                "latency": step_latency,
                "tokens": est_tokens
            }
        }
        
        watermark_data = {}
        if is_watermarked:
            # Watermark Trace
            # Get the exact bits consumed
            embedded_bits = sess.rlnc.get_stream(start_index=sess.bit_index, length=consumed_bits)
            
            matrix_rows = []
            
            # Generate real RLNC coefficients for the consumed bits
            # The bits consumed were at absolute indices [sess.bit_index ... sess.bit_index + consumed_bits - 1]
            for i in range(consumed_bits):
                abs_idx = sess.bit_index + i
                coeffs = sess.rlnc._generate_coeffs(abs_idx)
                matrix_rows.append(coeffs)
            
            watermark_data = {
                "bits": embedded_bits,
                "matrixRows": matrix_rows,
                "rankContribution": len(embedded_bits)
            }
            return final_data, watermark_data, consumed_bits
        
        return final_data, None, 0


    # MAIN GENERATOR
    async def step_generator():
        queue = asyncio.Queue()
        
        # Create tasks
        task_wm = asyncio.create_task(step_single_agent(sess.watermarked_state, True, queue))
        task_bl = asyncio.create_task(step_single_agent(sess.baseline_state, False, queue))
        
        pending_tasks = {task_wm, task_bl}
        
        while pending_tasks:
            # Wait for either queue item or task completion
            # We create a task for queue.get()
            queue_task = asyncio.create_task(queue.get())
            
            done, pending = await asyncio.wait(
                pending_tasks | {queue_task},
                return_when=asyncio.FIRST_COMPLETED
            )
            
            # Handle queue item
            if queue_task in done:
                chunk = queue_task.result()
                yield json.dumps(chunk) + "\n"
            else:
                queue_task.cancel()
            
            # Handle agent tasks completion
            for t in done:
                if t in pending_tasks:
                    pending_tasks.remove(t)
        
        # Consume any remaining queue items
        while not queue.empty():
            chunk = await queue.get()
            yield json.dumps(chunk) + "\n"
        
        # Get results
        try:
            result_wm = await task_wm
            result_bl = await task_bl
            
            # Unpack Watermark Result
            if result_wm:
                final_data_wm, wm_trace, consumed = result_wm
                sess.bit_index += consumed
                final_data_wm["watermark"] = wm_trace
                yield json.dumps({"type": "result", "data": final_data_wm}) + "\n"
                
            # Unpack Baseline Result
            if result_bl:
                final_data_bl, _, _ = result_bl
                final_data_bl["watermark"] = { "bits": "", "matrixRows": [], "rankContribution": 0 }
                yield json.dumps({"type": "result", "data": final_data_bl}) + "\n"
                
        except Exception as e:
            print(f"[ERROR] Task execution failed: {e}")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(step_generator(), media_type="application/x-ndjson")
    
class EvaluateRequest(BaseModel):
    sessionId: str
    language: Optional[str] = "en"  # "en" or "zh"

@app.post("/api/evaluate")
async def evaluate_session(req: EvaluateRequest):
    print(f"[INFO] Evaluate request for session: {req.sessionId}")
    print(f"[INFO] Available sessions: {list(sessions.keys())}")
    
    if req.sessionId not in sessions:
        print(f"[ERROR] Session {req.sessionId} not found in sessions dict")
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    # Language Instruction
    lang_instruction = "Reasoning must be in English."
    if req.language == "zh":
        lang_instruction = "请使用中文进行简要评价 (Reasoning must be in Chinese)."

    # helper to summarize trajectory
    def summarize_trajectory(traj):
        summary = ""
        for t in traj:
            role = t["role"]
            msg = t["message"]
            if role == "user":
                summary += f"User: {msg}\n"
            elif role == "assistant":
                # Try parse thought/action
                try:
                    data = json.loads(msg)
                    summary += f"Assistant Thought: {data.get('thought')}\nAssistant Action: {data.get('action')}\n"
                    if "final_answer" in data.get("action_args", {}):
                         summary += f"Assistant Final Answer: {data['action_args']['final_answer']}\n"
                except:
                    summary += f"Assistant: {msg}\n"
            elif role == "tool":
                summary += f"Tool Output: {msg[:200]}...\n"
        return summary

    baseline_summary = summarize_trajectory(sess.baseline_state.trajectory)
    watermarked_summary = summarize_trajectory(sess.watermarked_state.trajectory)
    query = sess.watermarked_state.task.get("query", "Unknown Task")

    # Anti-Bias: Randomize Order
    import random
    is_baseline_A = random.choice([True, False])

    if is_baseline_A:
        summary_A = baseline_summary
        summary_B = watermarked_summary
    else:
        summary_A = watermarked_summary
        summary_B = baseline_summary
    
    prompt = f"""Task: {query}
    
    Model A Trajectory/Answer:
    {summary_A}

    Model B Trajectory/Answer:
    {summary_B}

    Please evaluate Model A and Model B based on the task using criteria such as correctness, efficiency, and helpfulness.
    Provide a score (0-10) for each and a brief reason.
    {lang_instruction}
    
    You must output strictly in JSON format:
    {{
        "model_a_score": <float>,
        "model_b_score": <float>,
        "reason": "<string>"
    }}
    """
    
    try:
        completion = await sess.async_client.chat.completions.create(
            model=sess.model,
            messages=[
                {"role": "system", "content": "You are an impartial judge evaluating two AI models."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        content = completion.choices[0].message.content
        # parse json
        try:
            start = content.find("{")
            end = content.rfind("}")
            json_str = content[start:end+1]
            raw_result = json.loads(json_str)

            # Map back to specific models
            if is_baseline_A:
                result = {
                    "model_a_score": raw_result.get("model_a_score", 0),
                    "model_b_score": raw_result.get("model_b_score", 0),
                    "reason": raw_result.get("reason", "")
                }
            res_json = json.loads(json_str)

            swapped = not is_baseline_A
            # map scores back to Baseline vs Ours
            # If swapped (Model A was Watermarked), then A was Ours, B was Base.
            # We want output: model_a_score=Base, model_b_score=Ours
            final_result = {}
            if swapped:
                 final_result = {
                     "model_a_score": res_json.get("model_b_score", 0), # A (now Base) = B (was Base)
                     "model_b_score": res_json.get("model_a_score", 0), # B (now Ours) = A (was Ours)
                     "reason": res_json.get("reason", "")
                 }
            else:
                 final_result = res_json

            sess.evaluation_result = final_result # Persist in session

            # Update the database with evaluation result
            try:
                # Try to get the original scenario ID from the session
                original_id = sess.watermarked_state.task.get("id") or sess.baseline_state.task.get("id")
                
                # If session ID contains "_restored", extract the original ID
                if "_restored" in req.sessionId:
                    # Format: sess_timestamp_ORIGINAL_ID_restored
                    parts = req.sessionId.split("_")
                    if len(parts) >= 3:
                        # Find the part that's not "sess", not a timestamp, and not "restored"
                        for part in parts:
                            if part not in ["sess", "restored"] and not part.isdigit():
                                original_id = part
                                break
                
                print(f"[INFO] Attempting to save evaluation for scenario: {original_id}")
                
                if original_id:
                    existing = db.get_conversation(original_id)
                    if existing:
                        existing["evaluation"] = final_result
                        db.save_conversation(existing)
                        print(f"[INFO] Successfully updated evaluation for scenario {original_id} in database")
                    else:
                        print(f"[WARN] Scenario {original_id} not found in database")
                else:
                    print(f"[WARN] Could not determine original scenario ID from session {req.sessionId}")
            except Exception as save_err:
                print(f"[WARN] Failed to auto-save evaluation to database: {save_err}")
                import traceback
                traceback.print_exc()

            return final_result
            
        except Exception as e:
            print("JSON Parse Error:", e)
            return {"model_a_score": 0, "model_b_score": 0, "reason": "Failed to parse result"}
            
    except Exception as e:
        print("Evaluation Error:", e)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
