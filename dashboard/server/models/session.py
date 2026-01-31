"""
Session and agent state models for the simulation.
"""
import time
import copy
from typing import Dict, List, Any, Optional
from openai import OpenAI, AsyncOpenAI

from dashboard.server.utils.config import PROJECT_ROOT, TOOL_DATA_ROOT, get_base_llm_base

# Import RLNC for watermark encoding
import sys
sys.path.append(str(PROJECT_ROOT))
from agentmark.core.rlnc_codec import DeterministicRLNC
from agentmark.environments.toolbench.adapter import ToolBenchAdapter


class AgentState:
    """Encapsulates the state for a single agent (Baseline or Watermarked)"""
    def __init__(self, task_data: Dict, role: str):
        self.role = role  # 'baseline' or 'watermarked'
        self.task = copy.deepcopy(task_data)  # Deep copy to ensure independent modification
        
        # ToolBench Adapter State
        self.adapter = ToolBenchAdapter(TOOL_DATA_ROOT)
        self.episode = self.adapter.prepare_episode(self.task)
        
        # Execution History
        self.trajectory: List[Dict[str, Any]] = []  # List of {role, message}
        self.swarm_history: List[Dict[str, Any]] = []
        self.step_count = 0
        self.last_observation = ""
        self.done = False


class Session:
    """Session state for a simulation run."""
    def __init__(self, session_id: str, api_key: str, task_data: Dict, payload: str = "1101"):
        self.session_id = session_id
        self.start_time = time.time()
        
        # Common Config
        self.max_steps = 15
        
        # Agent States
        self.watermarked_state = AgentState(task_data, 'watermarked')
        self.baseline_state = AgentState(task_data, 'baseline')
        
        # Payload / Watermark State (Only for watermarked agent)
        self.bit_stream_str_raw = payload if payload else "1101"
        # Initialize RLNC
        self.rlnc = DeterministicRLNC(self.bit_stream_str_raw)
        self.bit_index = 0
        
        # LLM Client
        base_url = get_base_llm_base()
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self.async_client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self.model = "deepseek-chat"
        self.evaluation_result: Optional[Dict[str, Any]] = None


# Global session store
sessions: Dict[str, Session] = {}
