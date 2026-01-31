"""
SDK entrypoints for exposing AgentMark watermark algorithms to external agents.
"""

from .watermarker import AgentWatermarker
from .prompt_adapter import (
    PromptWatermarkWrapper,
    choose_action_from_prompt_output,
    get_prompt_instruction,
)

__all__ = [
    "AgentWatermarker",
    "PromptWatermarkWrapper",
    "choose_action_from_prompt_output",
    "get_prompt_instruction",
]
