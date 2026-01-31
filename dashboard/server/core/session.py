import copy
import time
from typing import Dict, List, Any, Optional
from openai import OpenAI, AsyncOpenAI
import sys

from dashboard.server.utils.config import SWARM_ROOT, TOOL_DATA_ROOT
from agentmark.core.rlnc_codec import DeterministicRLNC
from agentmark.environments.toolbench.adapter import ToolBenchAdapter

# --- AgentState ---
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
        self.swarm_history: List[Dict[str, Any]] = []
        self.step_count = 0
        self.last_observation = ""
        self.last_tokens = 0.0
        self.done = False

# --- Session ---
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

# Global session storage
sessions: Dict[str, Session] = {}
