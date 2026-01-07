
import sys
import os
import json
import random
import time
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

# AgentMark Imports
from agentmark.core.parser_utils import extract_and_normalize_probabilities
from agentmark.core.watermark_sampler import sample_behavior_differential
from agentmark.environments.toolbench.adapter import ToolBenchAdapter
from agentmark.environments.toolbench.data_loader import ToolBenchDataLoader
from agentmark.environments.toolbench.prompt import build_messages

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Session Management ---

class Session:
    def __init__(self, session_id: str, api_key: str, task_data: Dict):
        self.session_id = session_id
        self.task = task_data
        self.step_count = 0
        self.max_steps = 10
        self.history_tools: List[str] = []
        self.trajectory: List[Dict] = []
        
        # Watermark State
        self.bit_index = 0
        # Load ground truth bit stream
        bit_stream_path = PROJECT_ROOT / "agentmark/data/bit_stream.txt"
        if bit_stream_path.exists():
            self.bit_stream = bit_stream_path.read_text().strip()
        else:
            self.bit_stream = "11001101" * 100 # Fallback
            
        # Initialize Client
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com" if "deepseek" in api_key else None # Simple heuristic or default
        )
        
        # Initialize Adapter
        # Note: We need to point to the correct toolenv paths
        toolenv_root = PROJECT_ROOT / "experiments/toolbench/data/data/toolenv/tools"
        self.adapter = ToolBenchAdapter(
            toolenv_root=toolenv_root,
            use_cache=True, # Use cache for stability/speed in demo
            cache_root=PROJECT_ROOT / "experiments/toolbench/data/fake_response_cache",
            client=self.client,
            model="gpt-3.5-turbo", # Default, can be overridden if we knew the model
            temperature=0.0
        )
        
        # Prepare Episode
        self.episode = self.adapter.prepare_episode(self.task)
        self.last_observation = self.episode["observation"]

sessions: Dict[str, Session] = {}

# --- Pydantic Models ---

class InitRequest(BaseModel):
    apiKey: str
    scenarioId: str # e.g. "3672"

class StepRequest(BaseModel):
    sessionId: str

class StepResponse(BaseModel):
    thought: str
    action: str
    observation: str
    done: bool
    watermark: Optional[Dict] = None
    distribution: Optional[List[Dict]] = None

# --- Helpers ---

def get_demo_tasks():
    # Load the specific tasks we used for the dashboard
    # 3672, 5965, 83
    tasks = {}
    
    # Helper to load a specific json
    def load_task(path_suffix, task_id):
        # Use demo_data for self-contained repo
        path = PROJECT_ROOT / f"demo_data/toolbench_data/{path_suffix}"
        if path.exists():
            with open(path, 'r') as f:
                data = json.load(f)
                tasks[task_id] = data
    
    load_task("round1/watermark/G2_category/3672.json", "3672")
    load_task("round1/watermark/G1_instruction/5965.json", "5965")
    load_task("round3/watermark/G2_category/83.json", "83")
    
    return tasks

DEMO_TASKS = get_demo_tasks()

# --- Endpoints ---

@app.post("/api/init")
async def init_session(req: InitRequest):
    session_id = f"sess_{int(time.time())}"
    
    if req.scenarioId not in DEMO_TASKS:
        # Fallback to first if not found, or error
        if not DEMO_TASKS:
             raise HTTPException(status_code=500, detail="No demo tasks found on server")
        task = list(DEMO_TASKS.values())[0]
    else:
        task = DEMO_TASKS[req.scenarioId]
        
    session = Session(session_id, req.apiKey, task)
    sessions[session_id] = session
    
    return {
        "sessionId": session_id, 
        "task": {
            "query": task.get("query"),
            "id": req.scenarioId
        },
        "totalSteps": 0 # Start
    }

def uniform_prob(commands: List[str]) -> Dict[str, float]:
    p = 1.0 / len(commands) if commands else 0
    return {c: p for c in commands}

@app.post("/api/step")
async def step_session(req: StepRequest):
    if req.sessionId not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    sess = sessions[req.sessionId]
    
    if sess.step_count >= sess.max_steps:
        return {"done": True, "thought": "Max steps reached", "action": "Finish", "observation": ""}

    # 1. Build Messages
    messages = build_messages(
        query=sess.task.get("query", ""),
        tool_summaries=sess.episode["tool_summaries"],
        admissible_commands=sess.episode["admissible_commands"]
    )
    # Add history
    # Reconstruct history from trajectory for model context
    # This is a simplified reconstruction. In real adapter it tracks it better.
    # We'll just trust the 'last_observation' and append it simply for the turn.
    # Note: build_messages returns the SYSTEM prompt and User Query.
    # We need to append the conversation history.
    for turn in sess.trajectory:
        if turn["role"] == "assistant":
             messages.append({"role": "assistant", "content": turn["message"]})
        elif turn["role"] == "tool":
             messages.append({"role": "user", "content": f"Observation:\n{turn['message']}\nContinue Thought/Action/Action Input."})

    # 2. Call Model
    try:
        # For this demo, using gpt-3.5-turbo or compatible
        response = sess.client.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=messages,
            temperature=0, # Deterministic for stability
            max_tokens=512
        )
        model_output = response.choices[0].message.content
    except Exception as e:
        print(f"Model Error: {e}")
        # Fallback mock response for demo stability if API fails
        model_output = json.dumps({
            "action_weights": uniform_prob(sess.episode["admissible_commands"]),
            "action_args": {},
            "thought": "API Call Failed. Using fallback."
        })

    # 3. Parse Probabilities
    probs = extract_and_normalize_probabilities(model_output, sess.episode["admissible_commands"])
    if not probs:
        probs = uniform_prob(sess.episode["admissible_commands"])
        
    # 4. Watermark Sampling
    # Normalize for sampling (remove Finish if needed, etc - simplified here)
    effective_probs = probs.copy() # Use full probs for demo simplification
    
    # Differential Sampling
    bit_before = sess.bit_index
    chosen, _, consumed_bits, _ = sample_behavior_differential(
        probabilities=effective_probs,
        bit_stream=sess.bit_stream,
        bit_index=sess.bit_index,
        context_for_key=sess.last_observation, # Use last obs as context hash
        round_num=sess.step_count
    )
    sess.bit_index += consumed_bits
    
    # 5. Parse Action Args
    # Simple parsing logic or reuse run_experiment logic
    # For speed, implementing simplified json extraction
    try:
        start = model_output.find("{")
        end = model_output.rfind("}")
        json_str = model_output[start:end+1] if start != -1 else "{}"
        data = json.loads(json_str)
        action_args = {}
        # Try to find args for chosen tool
        if "action_args" in data:
            action_args = data["action_args"].get(chosen, {})
    except:
        action_args = {}

    action_obj = {"tool": chosen, "arguments": action_args}
    
    # Update Trajectory (Assistant)
    sess.trajectory.append({"role": "assistant", "message": model_output})
    
    thought = ""
    # Extract thought
    if "Thought:" in model_output:
        thought = model_output.split("Thought:")[1].split("\n")[0].strip()
    
    # 6. Execute Tool
    step_result = sess.adapter.step(action_obj, sess.episode["tool_summaries"], state=sess.task)
    observation = step_result["observation"]
    done = step_result.get("done", False) or chosen == "Finish"
    
    # Update Trajectory (Tool)
    sess.trajectory.append({"role": "tool", "message": observation})
    sess.last_observation = observation
    sess.step_count += 1
    
    # 7. Construct Watermark Trace for Dashboard
    # Need matrix rows for visualization
    # We can use the mockData helper logic here or the real logic if accessible
    # For now, we simulate the matrix rows based on the bits we consumed
    
    embedded_bits = sess.bit_stream[bit_before : sess.bit_index]
    # Generate deterministic rows based on step index + bit offset
    matrix_rows = []
    
    def generate_row(seed):
        # Mirroring the JS logic for consistency
        row = []
        import math
        for i in range(16):
            x = math.sin(seed + i) * 10000
            row.append(1 if (x - math.floor(x)) > 0.5 else 0)
        return row

    for i in range(len(embedded_bits)):
        matrix_rows.append(generate_row(sess.step_count * 100 + i + int(sess.session_id.split('_')[1])))

    trace = {
        "bits": embedded_bits,
        "matrixRows": matrix_rows,
        "rankContribution": len(embedded_bits)
    }
    
    # Distribution for Chart
    dist_list = [{"name": k, "prob": v, "isSelected": k==chosen} for k, v in probs.items()]
    
    return {
        "thought": thought or "Processing...",
        "action": f"Call: {chosen}",
        "observation": observation[:200] + "..." if len(observation) > 200 else observation,
        "done": done,
        "watermark": trace,
        "distribution": dist_list,
        "stepIndex": sess.step_count - 1
    }
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
