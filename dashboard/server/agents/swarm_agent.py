import json
from typing import Dict, List, Optional, Any

# --- Swarm Tools ---

def get_weather(location: str, time: str = "now") -> str:
    """Get the current weather in a given location. Location MUST be a city."""
    return json.dumps({"location": location, "temperature": "65", "time": time})

def get_weather_forecast(location: str, days: str = "3") -> str:
    """Get a short weather forecast for a given location and number of days."""
    try:
        days_val = int(days)
    except Exception:
        days_val = 3
    return json.dumps(
        {"location": location, "days": days_val, "forecast": ["sunny", "cloudy", "rain"]}
    )

def get_air_quality(location: str) -> str:
    """Get a simple air quality report for a given location."""
    return json.dumps({"location": location, "aqi": 42, "status": "good"})

def send_email(recipient: str, subject: str, body: str) -> str:
    """Send a short email."""
    print("Sending email...")
    print(f"To: {recipient}")
    print(f"Subject: {subject}")
    print(f"Body: {body}")
    return "Sent!"

def send_sms(phone_number: str, message: str) -> str:
    """Send a short SMS message to a phone number."""
    print("Sending sms...")
    print(f"To: {phone_number}")
    print(f"Message: {message}")
    return "Sent!"

def get_top_rated_movies(limit: int = 10, min_imdb: float = 8.0) -> str:
    """Return a list of top-rated movies with IMDb scores."""
    return json.dumps(
        {
            "limit": limit,
            "min_imdb": min_imdb,
            "results": [
                {"title": "The Shawshank Redemption", "imdb": 9.3},
                {"title": "The Godfather", "imdb": 9.2},
                {"title": "The Dark Knight", "imdb": 9.0},
            ],
        }
    )

def search_movies_by_genre(genre: str, limit: int = 10) -> str:
    """Search movies by genre."""
    return json.dumps(
        {
            "genre": genre,
            "limit": limit,
            "results": ["Inception", "Interstellar", "The Matrix"],
        }
    )

def get_movie_summary(title: str) -> str:
    """Fetch a short summary for a movie title."""
    return json.dumps(
        {
            "title": title,
            "summary": "A brief synopsis for the requested movie.",
        }
    )

def search_web(query: str) -> str:
    """Search the web for general queries."""
    return json.dumps({"query": query, "results": []})


ADD_AGENT_SYSTEM_PROMPT = "You are a helpful agent."
TOOLBENCH_SWARM_PROMPT = (
    "You are a tool-using agent. Use the provided tools to solve the task. "
    "Call a tool when needed; otherwise, respond with the final answer."
)

_SWARM_ADD_AGENT = None
_SWARM_TOOLBENCH_AGENT = None

def get_swarm_add_agent():
    global _SWARM_ADD_AGENT
    if _SWARM_ADD_AGENT is None:
        from swarm import Agent
        _SWARM_ADD_AGENT = Agent(
            name="General Tool Agent",
            instructions=ADD_AGENT_SYSTEM_PROMPT,
            functions=[
                get_weather,
                get_weather_forecast,
                get_air_quality,
                get_top_rated_movies,
                search_movies_by_genre,
                get_movie_summary,
                search_web,
                send_email,
                send_sms,
            ],
        )
    return _SWARM_ADD_AGENT

def get_swarm_toolbench_agent():
    global _SWARM_TOOLBENCH_AGENT
    if _SWARM_TOOLBENCH_AGENT is None:
        from swarm import Agent
        _SWARM_TOOLBENCH_AGENT = Agent(
            name="ToolBench Agent",
            instructions=TOOLBENCH_SWARM_PROMPT,
        )
    return _SWARM_TOOLBENCH_AGENT


def toolbench_param_to_schema(param: Any) -> Optional[Dict[str, Any]]:
    if isinstance(param, dict):
        name = param.get("name") or param.get("parameter") or param.get("field")
        if not name:
            return None
        param_type = (param.get("type") or param.get("param_type") or "string").lower()
        description = (param.get("description") or param.get("desc") or "").strip()
    elif isinstance(param, str):
        name = param
        param_type = "string"
        description = ""
    else:
        return None

    if param_type not in {"string", "number", "integer", "boolean", "object", "array"}:
        param_type = "string"

    schema = {"name": name, "type": param_type}
    if description:
        schema["description"] = description
    return schema


def build_toolbench_tools(tool_summaries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tools: List[Dict[str, Any]] = []
    for tool in tool_summaries:
        if not isinstance(tool, dict):
            continue
        name = tool.get("name") or ""
        if not name:
            continue
        description = (tool.get("description") or "").strip()
        required_items = tool.get("required_parameters") or []
        optional_items = tool.get("optional_parameters") or []

        properties: Dict[str, Any] = {}
        required: List[str] = []

        for item in required_items:
            schema = toolbench_param_to_schema(item)
            if not schema:
                continue
            properties[schema["name"]] = {k: v for k, v in schema.items() if k != "name"}
            required.append(schema["name"])

        for item in optional_items:
            schema = toolbench_param_to_schema(item)
            if not schema:
                continue
            if schema["name"] in properties:
                continue
            properties[schema["name"]] = {k: v for k, v in schema.items() if k != "name"}

        parameters: Dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            parameters["required"] = required

        tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            }
        )
    return tools
