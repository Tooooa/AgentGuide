"""
Database module for storing conversation history using SQLite.
"""
import sqlite3
import json
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime

class ConversationDB:
    def __init__(self, db_path: str = "dashboard/data/conversations.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()
    
    def init_db(self):
        """Initialize database schema"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title_en TEXT NOT NULL,
                title_zh TEXT,
                task_name TEXT,
                user_query TEXT,
                total_steps INTEGER DEFAULT 0,
                steps_json TEXT,
                payload TEXT,
                evaluation_json TEXT,
                scenario_type TEXT DEFAULT 'benchmark',
                is_pinned INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Add is_pinned column if it doesn't exist (for existing databases)
        try:
            cursor.execute("ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        
        # Add columns if they don't exist (for existing databases)
        try:
            cursor.execute("ALTER TABLE conversations ADD COLUMN is_pinned INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists

        try:
            cursor.execute("ALTER TABLE conversations ADD COLUMN scenario_type TEXT DEFAULT 'benchmark'")
        except sqlite3.OperationalError:
            pass  # Column already exists
        
        # Create index for faster queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_created_at 
            ON conversations(created_at DESC)
        """)
        
        conn.commit()
        conn.close()
    
    def save_conversation(self, conversation_data: Dict) -> str:
        """Save or update a conversation"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        conv_id = conversation_data.get("id")
        title = conversation_data.get("title", {})
        
        # Handle title format
        if isinstance(title, str):
            title_en = title
            title_zh = title
        else:
            title_en = title.get("en", "Untitled")
            title_zh = title.get("zh", title_en)
        
        steps = conversation_data.get("steps", [])
        evaluation = conversation_data.get("evaluation")
        
        cursor.execute("""
            INSERT OR REPLACE INTO conversations 
            (id, title_en, title_zh, task_name, user_query, total_steps, 
             steps_json, payload, evaluation_json, scenario_type, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            conv_id,
            title_en,
            title_zh,
            conversation_data.get("taskName", ""),
            conversation_data.get("userQuery", ""),
            conversation_data.get("totalSteps", len(steps)),
            json.dumps(steps, ensure_ascii=False),
            conversation_data.get("payload", ""),
            json.dumps(evaluation, ensure_ascii=False) if evaluation else None,
            conversation_data.get("type", "benchmark")
        ))
        
        conn.commit()
        conn.close()
        
        return conv_id
    
    def get_conversation(self, conv_id: str) -> Optional[Dict]:
        """Get a single conversation by ID"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM conversations WHERE id = ?
        """, (conv_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return self._row_to_dict(row)
    
    def list_conversations(self, limit: int = 100, search: str = None, type_filter: str = None) -> List[Dict]:
        """List all conversations, pinned first, then newest first, with optional search and type filter"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = "SELECT * FROM conversations WHERE 1=1"
        params = []

        if type_filter:
            query += " AND scenario_type = ?"
            params.append(type_filter)

        if search:
            search_pattern = f"%{search}%"
            query += " AND (title_en LIKE ? OR title_zh LIKE ? OR user_query LIKE ?)"
            params.extend([search_pattern, search_pattern, search_pattern])

        query += " ORDER BY is_pinned DESC, created_at DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)
        
        rows = cursor.fetchall()
        conn.close()
        
        return [self._row_to_dict(row) for row in rows]
    
    def delete_conversation(self, conv_id: str) -> bool:
        """Delete a conversation"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        deleted = cursor.rowcount > 0
        
        conn.commit()
        conn.close()
        
        return deleted
    
    def clear_all_conversations(self) -> int:
        """Clear all conversation history"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM conversations")
        count = cursor.fetchone()[0]
        
        cursor.execute("DELETE FROM conversations")
        
        conn.commit()
        conn.close()
        
        return count
    
    def toggle_pin(self, conversation_id: str) -> bool:
        """Toggle pin status of a conversation"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get current pin status
        cursor.execute("SELECT is_pinned FROM conversations WHERE id = ?", (conversation_id,))
        row = cursor.fetchone()
        
        if row is None:
            conn.close()
            return False
        
        current_status = row[0]
        new_status = 0 if current_status else 1
        
        # Update pin status
        cursor.execute(
            "UPDATE conversations SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, conversation_id)
        )
        
        conn.commit()
        conn.close()
        
        return True
    
    def _row_to_dict(self, row: sqlite3.Row) -> Dict:
        """Convert database row to conversation dict"""
        steps = json.loads(row["steps_json"]) if row["steps_json"] else []
        evaluation = json.loads(row["evaluation_json"]) if row["evaluation_json"] else None
        
        return {
            "id": row["id"],
            "title": {
                "en": row["title_en"],
                "zh": row["title_zh"] or row["title_en"]
            },
            "taskName": row["task_name"],
            "userQuery": row["user_query"],
            "totalSteps": row["total_steps"],
            "steps": steps,
            "payload": row["payload"],
            "evaluation": evaluation,
            "type": row["scenario_type"] if "scenario_type" in row.keys() else "benchmark",
            "isPinned": bool(row["is_pinned"]) if "is_pinned" in row.keys() else False,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"]
        }
    
    def migrate_from_json(self, json_dir: Path):
        """Migrate existing JSON files to database"""
        if not json_dir.exists():
            return
        
        migrated = 0
        for json_file in json_dir.glob("*.json"):
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.save_conversation(data)
                    migrated += 1
            except Exception as e:
                print(f"[WARN] Failed to migrate {json_file}: {e}")
        
        print(f"[INFO] Migrated {migrated} conversations from JSON to database")
