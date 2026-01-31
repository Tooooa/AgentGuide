from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class CustomInitRequest(BaseModel):
    apiKey: Optional[str] = None
    query: str
    payload: Optional[str] = None

class StepRequest(BaseModel):
    sessionId: str

class ContinueRequest(BaseModel):
    sessionId: str
    prompt: str

class GenerateTitleRequest(BaseModel):
    history: List[Dict] # List of {role, content/message}

class RestoreSessionRequest(BaseModel):
    apiKey: Optional[str] = None
    scenarioId: str

class EvaluateRequest(BaseModel):
    sessionId: str
    language: str = "en"
