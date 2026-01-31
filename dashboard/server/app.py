import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys

from dashboard.server.utils.config import PROJECT_ROOT, SWARM_ROOT
from dashboard.server.services.retriever_service import init_retriever

# Add paths for dynamic imports
sys.path.append(str(PROJECT_ROOT))
if SWARM_ROOT.exists():
    sys.path.append(str(SWARM_ROOT))

# --- App Setup ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include Routers ---
from dashboard.server.routers.scenarios import router as scenarios_router
from dashboard.server.routers.api import router as api_router

app.include_router(scenarios_router)
app.include_router(api_router)

@app.on_event("startup")
async def startup_event():
    print("[INFO] Initializing ToolBench Retriever...")
    asyncio.create_task(init_retriever())
    print("[INFO] Server Started.")

