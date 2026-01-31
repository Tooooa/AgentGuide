"""ToolBench adapter.
Responsibilities: wrap ToolBench/StableToolBench data into AgentMark's unified interface."""

import json
import re
import hashlib
import os
from pathlib import Path
from typing import Dict, List, Optional, Set, Any
from .fake_response import generate_fake_response


def _standardize_tool_name(name: str) -> str:
    """Normalize tool/API names into identifier-friendly strings."""
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", name or "").strip("_")
    return cleaned or "Tool"


def _dedupe_name(candidate: str, used: Set[str]) -> str:
    """Ensure tool names are unique; append a numeric suffix if needed."""
    if candidate not in used:
        used.add(candidate)
        return candidate
    idx = 2
    new_name = f"{candidate}__{idx}"
    while new_name in used:
        idx += 1
        new_name = f"{candidate}__{idx}"
    used.add(new_name)
    return new_name


class ToolBenchAdapter:
    """Convert a single ToolBench query into observation + admissible_commands."""

    def __init__(
        self,
        toolenv_root: Path,
        use_cache: bool = True,
        cache_root: Optional[Path] = None,
        client: Any = None,
        model: str = "deepseek-chat",
        temperature: float = 0.0,
        fake_cache_root: Optional[Path] = None,
    ) -> None:
        self.toolenv_root = Path(toolenv_root)
        self.use_cache = use_cache
        self.cache_root = Path(cache_root) if cache_root else None
        self.client = client
        self.model = model
        self.temperature = temperature
        
        # Initialize fake response cache
        self.fake_cache_root = Path(fake_cache_root) if fake_cache_root else Path("experiments/toolbench/data/fake_response_cache")
        self.fake_cache_root.mkdir(parents=True, exist_ok=True)

    def build_tool_summaries(self, task: dict) -> List[Dict]:
        used_names: Set[str] = set()
        summaries = []
        for idx, api in enumerate(task.get("api_list", []), start=1):
            raw_tool_name = api.get("tool_name", "UnknownTool")
            api_name = api.get("api_name", f"api_{idx}")
            base = _standardize_tool_name(raw_tool_name)
            api_slug = _standardize_tool_name(api_name)
            tool_name = _dedupe_name(f"{base}__{api_slug}", used_names)
            description = api.get("api_description", "").strip()
            if not description:
                description = "No description provided."
            summaries.append(
                {
                    "name": tool_name,  # Unique name exposed to the model
                    "raw_tool_name": raw_tool_name,
                    "api_name": api_name,
                    "category": api.get("category_name", ""),
                    "description": description,
                    "required_parameters": api.get("required_parameters", []),
                    "optional_parameters": api.get("optional_parameters", []),
                }
            )
        return summaries

    def build_observation(self, query: str, tool_summaries: List[Dict]) -> str:
        lines = [f"User Query: {query}", "Available Tools:"]
        for idx, tool in enumerate(tool_summaries, start=1):
            desc = tool["description"].replace("\n", " ")[:512]
            lines.append(
                f"{idx}. {tool['name']} [tool={tool.get('raw_tool_name','')}, api={tool.get('api_name','')}]: {desc}"
            )
        lines.append("You must pick one tool or Finish.")
        return "\n".join(lines)

    def prepare_episode(self, task: dict) -> Dict:
        tool_summaries = self.build_tool_summaries(task)
        admissible = [t["name"] for t in tool_summaries] + ["Finish"]
        observation = self.build_observation(task.get("query", ""), tool_summaries)
        # Store query for fake response context
        self.current_query = task.get("query", "")
        return {
            "task": task,
            "tool_summaries": tool_summaries,
            "admissible_commands": admissible,
            "observation": observation,
        }

    def step(
        self,
        action: Dict,
        tool_summaries: List[Dict],
        state: Optional[dict] = None,
    ) -> Dict:
        """Execute one step; uses cache/mock execution and returns observable text."""
        tool = action.get("tool") or action.get("action")
        arguments = action.get("arguments") or action.get("action_input") or {}
        info = {"tool": tool, "arguments": arguments}

        if tool == "Finish":
            final_answer = arguments if isinstance(arguments, str) else arguments.get("final_answer", "")
            return {
                "observation": f"[Finish] {final_answer}",
                "done": True,
                "reward": 1.0 if final_answer else 0.0,
                "info": info,
            }

        matched = next((t for t in tool_summaries if t["name"] == tool), None)
        if matched:
            desc = matched["description"]
            cat = matched.get("category", "")
            api_name = matched.get("api_name", "")
            raw_tool_name = matched.get("raw_tool_name", "")
            cache_obs = self._lookup_cache(
                api_name=api_name, 
                args=arguments, 
                category=cat, 
                tool_name=raw_tool_name
            )
            if cache_obs:
                obs = (
                    f"[Cache] tool={tool} category={cat} api={api_name} "
                    f"args={arguments} | response={cache_obs}"
                )
            elif self.client:
                # Third line of defense: Fake response generation
                api_doc = {
                    "name": f"{cat}/{tool}",
                    "description": desc,
                    "required_parameters": matched.get("required_parameters", []),
                    "optional_parameters": matched.get("optional_parameters", []),
                }
                api_examples = self._get_cache_examples(api_name, cat, raw_tool_name)
                
                # Check local fake cache first
                query = getattr(self, "current_query", "")
                cache_key = self._get_fake_cache_key(f"{cat}/{tool}", arguments, query)
                
                # Sanitize names for directory structure
                s_cat = re.sub(r"[^A-Za-z0-9_]+", "_", cat or "Default").strip("_")
                s_tool = re.sub(r"[^A-Za-z0-9_]+", "_", raw_tool_name or tool or "Tool").strip("_")
                s_api = re.sub(r"[^A-Za-z0-9_]+", "_", api_name or "API").strip("_")
                
                # User requested to NOT use fake cache (always regenerate)
                # fake_resp = self._load_from_fake_cache(cache_key, s_cat, s_tool, s_api)
                fake_resp = None 
                
                if fake_resp is None:
                    fake_resp = generate_fake_response(
                        client=self.client,
                        model=self.model,
                        api_doc=api_doc,
                        tool_input=arguments,
                        api_examples=api_examples,
                        temperature=self.temperature,
                        query=query
                    )
                    # Save to cache (Regenerate/Overwrite)
                    self._save_to_fake_cache(cache_key, fake_resp, s_cat, s_tool, s_api)
                    obs_prefix = "[Gen]" # Generated fresh
                else:
                    obs_prefix = "[CacheGen]"

                obs = (
                    f"{obs_prefix} tool={tool} category={cat} api={api_name} "
                    f"args={arguments} | response={json.dumps(fake_resp, ensure_ascii=False)}"
                )
            else:
                obs = (
                    f"tool={tool} category={cat} api={api_name} "
                    f"args={arguments} | desc={desc[:200]}"
                )
        else:
            obs = f"Unknown tool {tool}, args={arguments}"

        # Reserved: future lookup to return real responses from StableToolBench cache
        return {"observation": obs, "done": False, "reward": 0.0, "info": info}

    def _lookup_cache(
        self, 
        api_name: str, 
        args: Dict, 
        category: str = "", 
        tool_name: str = ""
    ) -> Optional[str]:
        """Lookup StableToolBench cache and return response string if hit."""
        if not self.use_cache or not self.cache_root:
            return None

        # 1. Sanitize names to match cache directory structure
        # e.g. "suivi-colis" -> "suivi_colis"
        # e.g. "Logistics" -> "Logistics"
        # e.g. "Latest" -> "latest"
        
        sanitized_tool = re.sub(r"[^A-Za-z0-9_]+", "_", tool_name or "").strip("_").lower()
        sanitized_cat = re.sub(r"[^A-Za-z0-9_]+", "_", category or "").strip("_")
        sanitized_api = re.sub(r"[^A-Za-z0-9]+", "_", api_name or "").strip("_").lower()
        
        if not sanitized_api or not sanitized_tool or not sanitized_cat:
            return None

        # Construct path: cache_root / Category / {Tool}_for_{Category} / {Api}.json
        # e.g. .../Logistics/suivi_colis_for_Logistics/latest.json
        tool_dir_name = f"{sanitized_tool}_for_{sanitized_cat}"
        cache_file = self.cache_root / sanitized_cat / tool_dir_name / f"{sanitized_api}.json"
        
        try:
            data = json.loads(cache_file.read_text())
        except Exception:
            return None
            


        candidates = []
        
        # 1. Clean args: remove None values to match StableToolBench cache keys
        # Official server uses str(input) directly, so we must match the cache's format.
        # Our model often produces "key": null, but cache keys usually omit these.
        cleaned_args = args
        if isinstance(args, dict):
            cleaned_args = {k: v for k, v in args.items() if v is not None}

        if isinstance(cleaned_args, dict):
            try:
                candidates.append(json.dumps(cleaned_args, sort_keys=True))
            except Exception:
                pass
            # Try variations of quoting (single vs double quotes) as seen in cache
            candidates.append(str(cleaned_args))
            if not cleaned_args:
                candidates.append("{}")
        else:
            candidates.append(str(cleaned_args))

        for key in candidates:
            if key in data:
                item = data[key]
                resp = item.get("response", "") if isinstance(item, dict) else item
                return json.dumps(resp, ensure_ascii=False) if isinstance(resp, (dict, list)) else str(resp)

        if "{}" in data:
            item = data["{}"]
            resp = item.get("response", "") if isinstance(item, dict) else item
            return json.dumps(resp, ensure_ascii=False) if isinstance(resp, (dict, list)) else str(resp)

        # This handles cases like "colisId" (model) vs "colisid" (cache)
        if isinstance(cleaned_args, dict):
            normalized_input = {k.lower(): v for k, v in cleaned_args.items()}
            
            for key_str, item in data.items():
                try:
                    # Try to parse the cache key as JSON
                    # Cache keys are usually stringified dicts, e.g. "{'colisid': '...'}"
                    # We need to handle single quotes which are common in python string representation but invalid JSON
                    key_json_str = key_str.replace("'", '"').replace("None", "null").replace("True", "true").replace("False", "false")
                    key_dict = json.loads(key_json_str)
                    
                    if isinstance(key_dict, dict):
                        normalized_key = {k.lower(): v for k, v in key_dict.items()}
                        if normalized_input == normalized_key:
                            # print(f"DEBUG: Case-insensitive match found! {cleaned_args} ~= {key_str}")
                            resp = item.get("response", "") if isinstance(item, dict) else item
                            return json.dumps(resp, ensure_ascii=False) if isinstance(resp, (dict, list)) else str(resp)
                except Exception:
                    # If parsing fails, skip this key
                    continue

        return None

    def _get_cache_examples(self, api_name: str, category: str, tool_name: str) -> List[Any]:
        """Retrieve examples from cache for fake response generation"""
        if not self.cache_root:
            return []
            
        sanitized_tool = re.sub(r"[^A-Za-z0-9_]+", "_", tool_name or "").strip("_").lower()
        sanitized_cat = re.sub(r"[^A-Za-z0-9_]+", "_", category or "").strip("_")
        sanitized_api = re.sub(r"[^A-Za-z0-9]+", "_", api_name or "").strip("_").lower()
        
        if not sanitized_api or not sanitized_tool or not sanitized_cat:
            return []

        tool_dir_name = f"{sanitized_tool}_for_{sanitized_cat}"
        cache_file = self.cache_root / sanitized_cat / tool_dir_name / f"{sanitized_api}.json"
        
        if not cache_file.exists():
            return []

        try:
            data = json.loads(cache_file.read_text())
            # Return first 5 items as examples
            return list(data.items())[:5]
        except Exception:
            return []

    def _get_fake_cache_key(self, tool_identifier: str, args: Dict, query: str) -> str:
        """Generate a deterministic hash key for the request."""
        # Sort args to ensure determinism
        if isinstance(args, dict):
            sorted_args = json.dumps(args, sort_keys=True, ensure_ascii=True)
        else:
            sorted_args = str(args)
        
        raw_key = f"{tool_identifier}|{sorted_args}|{query}"
        return hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

    def _load_from_fake_cache(self, key: str, category: str, tool: str, api: str) -> Optional[Dict]:
        """Load fake response from local cache organized by tool."""
        if not self.fake_cache_root:
            return None
            
        # Structure: root / category / tool / api / hash.json
        cache_path = self.fake_cache_root / category / tool / api / f"{key}.json"
        
        if cache_path.exists():
            try:
                return json.loads(cache_path.read_text())
            except Exception:
                return None
        return None

    def _save_to_fake_cache(self, key: str, response: Dict, category: str, tool: str, api: str) -> None:
        """Save fake response to local cache organized by tool."""
        if not self.fake_cache_root:
            return
            
        # Structure: root / category / tool / api / hash.json
        target_dir = self.fake_cache_root / category / tool / api
        target_dir.mkdir(parents=True, exist_ok=True)
        
        cache_path = target_dir / f"{key}.json"
        try:
            cache_path.write_text(json.dumps(response, ensure_ascii=False, indent=2))
        except Exception:
            pass
