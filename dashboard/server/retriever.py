import json
import os
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    from sentence_transformers import SentenceTransformer, util
    import torch
except ImportError:
    print("[WARN] sentence-transformers not found. Retrieval will fail.")
    SentenceTransformer = None

class ToolBenchRetriever:
    """
    Retriever for ToolBench APIs using SentenceTransformers.
    Indexes tool descriptions from the file system and performs semantic search.
    """
    def __init__(
        self, 
        data_root: str, 
        model_path: str = "ToolBench/ToolBench_IR_bert_based_uncased",
        device: str = None
    ):
        self.data_root = Path(data_root)
        self.model_path = model_path
        
        if device:
            self.device = device
        else:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[INFO] Using device: {self.device}")
        self.model = None
        self.corpus_embeddings = None
        self.documents: List[Dict] = []
        
        print(f"[INFO] Initializing ToolBenchRetriever with data_root={self.data_root}")
        
    def load_model(self):
        """Lazy load the model."""
        if self.model is None and SentenceTransformer:
            print(f"[INFO] Loading SentenceTransformer: {self.model_path}")
            try:
                self.model = SentenceTransformer(self.model_path, device=self.device)
            except Exception as e:
                print(f"[ERROR] Failed to load model {self.model_path}: {e}")
                # Fallback to a standard small model if specific one fails or needs auth
                print("[INFO] Falling back to 'all-MiniLM-L6-v2'")
                try:
                    self.model = SentenceTransformer('all-MiniLM-L6-v2', device=self.device)
                except Exception as e2:
                    print(f"[ERROR] Fallback failed: {e2}")

    def index_tools(self):
        """Walk the data_root and index all tool APIs."""
        if not self.data_root.exists():
            print(f"[ERROR] Data root {self.data_root} does not exist.")
            return

        # Try loading from cache first
        # Cache file relative to data root or project root? 
        # Let's verify if data root is writable or put it in a known cache dir.
        # For simple usage, put it alongside the script or in data dir.
        cache_file = self.data_root / "retriever_cache.pt"
        if self.load_cache(str(cache_file)):
            return

        print("[INFO] Indexing tools... this may take a moment.")
        start_time = time.time()
        
        self.documents = []
        
        # Traverse categories
        for category_dir in self.data_root.iterdir():
            if not category_dir.is_dir():
                continue
            
            category_name = category_dir.name
            
            # Traverse tool files (json)
            for tool_file in category_dir.glob("*.json"):
                try:
                    content = tool_file.read_text(encoding='utf-8')
                    data = json.loads(content)
                    
                    # ToolBench JSON could be a dict (single tool info) or list (multiple apis)
                    # Based on observation, it seems to be an object with tool_name and api_list, 
                    # OR a list of API objects directly? 
                    # Let's inspect the vortex.json output we saw: 
                    # { "tool_name": "...", "api_list": [ ... ] }
                    # Wait, the `cat` output showed:
                    # { "tool_name": "vortex", ... "api_list": [ { "name": "get...", "description": "..." } ] }
                    
                    tool_name = data.get("tool_name", tool_file.stem)
                    apis = data.get("api_list", [])
                    
                    if not apis and isinstance(data, list):
                         # Some files might be just a list of endpoints? 
                         # Usually standard format is object with api_list.
                         apis = data 

                    for api in apis:
                        api_name = api.get("name", "unknown")
                        description = api.get("description", "").strip()
                        
                        # Construct a "document" for retrieval
                        # Format commonly used: "Category: ... Tool: ... API: ... Description: ..."
                        doc_text = f"Category: {category_name}, Tool: {tool_name}, API: {api_name}, Description: {description}"
                        
                        self.documents.append({
                            "text": doc_text,
                            "category_name": category_name,
                            "tool_name": tool_name,
                            "api_name": api_name,
                            "api_description": description,
                            "raw_data": api # Keep raw data to return
                        })
                        
                except Exception as e:
                    print(f"[WARN] Failed to parse {tool_file}: {e}")
                    continue
                    
        print(f"[INFO] Indexed {len(self.documents)} APIs in {time.time() - start_time:.2f}s")
        
        # Pre-compute embeddings
        if self.model and self.documents:
            print("[INFO] Encoding corpus...")
            sentences = [d["text"] for d in self.documents]
            self.corpus_embeddings = self.model.encode(sentences, convert_to_tensor=True, show_progress_bar=True)
            print("[INFO] Encoding complete.")
            
            # Save to cache
            cache_file = self.data_root / "retriever_cache.pt"
            self.save_cache(str(cache_file))

    def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        Retrieve top_k APIs semanticallly relevant to the query.
        Returns a list of API definition dicts (compatible with ToolBench task format).
        """
        if not self.model:
            self.load_model()
            
        if self.corpus_embeddings is None and self.model:
            self.index_tools()
            
        if not self.model or self.corpus_embeddings is None:
            return []
            
        # Encode query
        query_embedding = self.model.encode(query, convert_to_tensor=True)
        
        # Cosine similarity
        cos_scores = util.cos_sim(query_embedding, self.corpus_embeddings)[0]
        top_results = torch.topk(cos_scores, k=min(top_k, len(self.documents)))
        
        retrieved_apis = []
        
        print(f"[INFO] Retrieval results for '{query}':")
        for score, idx in zip(top_results.values, top_results.indices):
            doc = self.documents[idx]
            print(f"  - [{score:.4f}] {doc['tool_name']}/{doc['api_name']}")
            
            # Format as expected by ToolBenchAdapter/Task
            # The task needs 'api_list' containing objects with:
            # category_name, tool_name, api_name, api_description, etc.
            
            api_obj = doc["raw_data"].copy()
            api_obj["category_name"] = doc["category_name"]
            api_obj["tool_name"] = doc["tool_name"]
            api_obj["api_name"] = doc["api_name"]
            api_obj["api_description"] = doc["api_description"]
            # api_obj might already have 'name' which is the api name. 
            # Adapter expects 'api_name' key specifically sometimes, or uses 'name'.
            # Adapter logic: 
            # raw_tool_name = api.get("tool_name", "UnknownTool")
            # api_name = api.get("api_name", f"api_{idx}")
            
            retrieved_apis.append(api_obj)
            
        return retrieved_apis

    def save_cache(self, cache_path: str = "toolbench_retriever_cache.pt"):
        """Save the current index and embeddings to disk."""
        if not self.documents or self.corpus_embeddings is None:
            print("[WARN] Nothing to save.")
            return
            
        print(f"[INFO] Saving cache to {cache_path}...")
        cache_data = {
            "documents": self.documents,
            "embeddings": self.corpus_embeddings
        }
        try:
            torch.save(cache_data, cache_path)
            print("[INFO] Cache saved successfully.")
        except Exception as e:
            print(f"[ERROR] Failed to save cache: {e}")

    def load_cache(self, cache_path: str = "toolbench_retriever_cache.pt") -> bool:
        """Load index and embeddings from disk."""
        path = Path(cache_path)
        if not path.exists():
            return False
            
        print(f"[INFO] Loading cache from {path}...")
        try:
            cache_data = torch.load(path, map_location=self.device)
            self.documents = cache_data["documents"]
            self.corpus_embeddings = cache_data["embeddings"]
            print(f"[INFO] Cache loaded. {len(self.documents)} documents ready.")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to load cache: {e}")
            return False

# Singleton instance or helper for testing
if __name__ == "__main__":
    # Test run
    root = r"D:\_Development\AgentMark\AgentMarkWeb\experiments\toolbench\data\data\toolenv\tools"
    retriever = ToolBenchRetriever(root)
    retriever.load_model()
    retriever.index_tools()
    results = retriever.retrieve("I need to check flight status")
    print("\nTop Result Example:", results[0] if results else "None")
