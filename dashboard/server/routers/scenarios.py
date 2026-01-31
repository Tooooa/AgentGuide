"""
Scenario management API routes.
"""
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from dashboard.server.database import ConversationDB
from dashboard.server.utils.config import PROJECT_ROOT


# Initialize database
db = ConversationDB(db_path=str(PROJECT_ROOT / "dashboard/data/conversations.db"))

router = APIRouter(prefix="/api", tags=["scenarios"])


@router.get("/scenarios")
async def list_scenarios(search: Optional[str] = None, limit: int = 100, type: Optional[str] = None):
    """List all saved conversations from database with optional search and type filter"""
    try:
        scenarios = db.list_conversations(limit=limit, search=search, type_filter=type)
        return scenarios
    except Exception as e:
        print(f"[ERROR] Failed to list scenarios: {e}")
        return []


class SaveScenarioRequest(BaseModel):
    title: Any  # str or dict
    data: Dict
    id: Optional[str] = None  # Optional ID to overwrite
    type: Optional[str] = "benchmark"  # Default to benchmark


@router.post("/save_scenario")
async def save_scenario(req: SaveScenarioRequest):
    """Save conversation to database"""
    try:
        scenario_id = req.id if req.id else str(uuid.uuid4())
        
        scenario_data = req.data
        scenario_data["id"] = scenario_id
        scenario_data["type"] = req.type
        
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


@router.delete("/scenarios/clear_all")
async def clear_all_history():
    """Clear all conversation history from database"""
    try:
        deleted_count = db.clear_all_conversations()
        print(f"[INFO] Cleared all history: {deleted_count} conversations deleted")
        return {"status": "success", "deleted_count": deleted_count}
    except Exception as e:
        print(f"[ERROR] Clear all failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scenarios/batch_delete")
async def batch_delete_scenarios(req: dict):
    """Batch delete multiple scenarios"""
    try:
        scenario_ids = req.get("ids", [])
        if not scenario_ids:
            return {"status": "success", "deleted_count": 0}
        
        deleted_count = 0
        for scenario_id in scenario_ids:
            if db.delete_conversation(scenario_id):
                deleted_count += 1
        
        print(f"[INFO] Batch deleted {deleted_count} scenarios")
        return {"status": "success", "deleted_count": deleted_count}
    except Exception as e:
        print(f"[ERROR] Batch delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scenarios/{scenario_id}/toggle_pin")
async def toggle_pin_scenario(scenario_id: str):
    """Toggle pin status of a conversation"""
    try:
        success = db.toggle_pin(scenario_id)
        if success:
            print(f"[INFO] Toggled pin status for scenario {scenario_id}")
            return {"status": "success", "id": scenario_id}
        else:
            raise HTTPException(status_code=404, detail="Scenario not found")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Toggle pin failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/scenarios/{scenario_id}")
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
