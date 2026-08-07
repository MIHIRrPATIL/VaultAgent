import sqlite3
import json
import os
from typing import Dict, Any, List, Optional
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "vault_agent_history.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS generation_sessions (
                session_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                prompt TEXT NOT NULL,
                mode TEXT NOT NULL,
                style_preset TEXT NOT NULL,
                length TEXT NOT NULL,
                linking_depth TEXT NOT NULL,
                status TEXT NOT NULL,
                output_files_count INTEGER DEFAULT 0,
                session_payload_json TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memory_entries (
                id TEXT PRIMARY KEY,
                scope TEXT CHECK(scope IN ('global', 'vault')) NOT NULL,
                vault_id TEXT,
                content TEXT NOT NULL,
                memory_type TEXT,
                tags TEXT,
                confidence REAL,
                status TEXT CHECK(status IN ('pending', 'confirmed', 'dismissed')) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        
        # Migration: add vector_json column if missing
        cursor = conn.execute("PRAGMA table_info(memory_entries)")
        cols = [row["name"] for row in cursor.fetchall()]
        if "vector_json" not in cols:
            conn.execute("ALTER TABLE memory_entries ADD COLUMN vector_json TEXT")
            conn.commit()

def save_session(session_id: str, prompt: str, mode: str, style_preset: str, length: str, linking_depth: str, status: str = "pending", output_files_count: int = 0, session_payload: Optional[Dict[str, Any]] = None):
    init_db()
    payload_str = json.dumps(session_payload) if session_payload else None
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO generation_sessions 
            (session_id, created_at, prompt, mode, style_preset, length, linking_depth, status, output_files_count, session_payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            datetime.utcnow().isoformat(),
            prompt,
            mode,
            style_preset,
            length,
            linking_depth,
            status,
            output_files_count,
            payload_str
        ))
        conn.commit()

def update_session(session_id: str, status: Optional[str] = None, output_files_count: Optional[int] = None, session_payload: Optional[Dict[str, Any]] = None):
    init_db()
    with get_db() as conn:
        session = get_session(session_id)
        if not session:
            return
        
        new_status = status if status is not None else session["status"]
        new_count = output_files_count if output_files_count is not None else session["output_files_count"]
        
        existing_payload = {}
        if session.get("session_payload_json"):
            try:
                existing_payload = json.loads(session["session_payload_json"])
            except Exception:
                pass
        
        if session_payload is not None:
            existing_payload.update(session_payload)

        conn.execute("""
            UPDATE generation_sessions
            SET status = ?, output_files_count = ?, session_payload_json = ?
            WHERE session_id = ?
        """, (new_status, new_count, json.dumps(existing_payload), session_id))
        conn.commit()

def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    init_db()
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM generation_sessions WHERE session_id = ?", (session_id,))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        if res.get("session_payload_json"):
            try:
                res["payload"] = json.loads(res["session_payload_json"])
            except Exception:
                res["payload"] = {}
        return res

def list_sessions(limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    init_db()
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT session_id, created_at, prompt, mode, style_preset, length, linking_depth, status, output_files_count FROM generation_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        )
        return [dict(row) for row in cursor.fetchall()]

def add_memory_entry(
    id: str,
    scope: str,
    vault_id: Optional[str],
    content: str,
    memory_type: Optional[str] = None,
    tags: Optional[List[str]] = None,
    confidence: float = 1.0,
    status: str = "pending",
    vector_json: Optional[str] = None
):
    init_db()
    tags_str = json.dumps(tags) if tags else "[]"
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO memory_entries
            (id, scope, vault_id, content, memory_type, tags, confidence, status, vector_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (id, scope, vault_id, content, memory_type, tags_str, confidence, status, vector_json))
        conn.commit()

def get_memory_entry(id: str) -> Optional[Dict[str, Any]]:
    init_db()
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM memory_entries WHERE id = ?", (id,))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        if res.get("tags"):
            try:
                res["tags"] = json.loads(res["tags"])
            except Exception:
                res["tags"] = []
        return res

def list_memory_entries(
    scope: Optional[str] = None,
    vault_id: Optional[str] = None,
    status: Optional[str] = None
) -> List[Dict[str, Any]]:
    init_db()
    with get_db() as conn:
        # Run auto-confirm check first
        conn.execute("""
            UPDATE memory_entries 
            SET status = 'confirmed' 
            WHERE status = 'pending' AND datetime(created_at) < datetime('now', '-7 days')
        """)
        conn.commit()

        query = "SELECT * FROM memory_entries WHERE 1=1"
        params = []
        if scope:
            query += " AND scope = ?"
            params.append(scope)
        if vault_id:
            query += " AND vault_id = ?"
            params.append(vault_id)
        if status:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY created_at DESC"
        cursor = conn.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        results = []
        for r in rows:
            d = dict(r)
            if d.get("tags"):
                try:
                    d["tags"] = json.loads(d["tags"])
                except Exception:
                    d["tags"] = []
            results.append(d)
        return results

def update_memory_status(id: str, status: str):
    init_db()
    with get_db() as conn:
        conn.execute("UPDATE memory_entries SET status = ? WHERE id = ?", (status, id))
        conn.commit()

def delete_memory_entry(id: str):
    init_db()
    with get_db() as conn:
        conn.execute("DELETE FROM memory_entries WHERE id = ?", (id,))
        conn.commit()
