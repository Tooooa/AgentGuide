"""
Retriever service for ToolBench tool retrieval.
"""
import asyncio
from typing import Optional

from dashboard.server.utils.config import TOOL_DATA_ROOT
from dashboard.server.retriever import ToolBenchRetriever


# Global retriever state
retriever: Optional[ToolBenchRetriever] = None
retriever_loading: bool = False


async def init_retriever() -> None:
    """Initialize the ToolBench retriever in background."""
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


def get_retriever() -> Optional[ToolBenchRetriever]:
    """Get the current retriever instance."""
    return retriever


def is_retriever_loading() -> bool:
    """Check if retriever is still loading."""
    return retriever_loading
