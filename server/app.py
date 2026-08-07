from fastapi import FastAPI, Query, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
import sys
import httpx
import asyncio

from indexer import indexer
from schemas import (
    PipelineRunRequest,
    SessionCommitRequest,
    KeyTestRequest
)
from pipeline import orchestrator, active_sessions
from agents.writer import writer_agent
from database import list_sessions, get_session, update_session

app = FastAPI(version="0.2.0", title="VaultAgent Services")
active_tasks: Dict[str, asyncio.Task] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "OK"}

class ScanRequest(BaseModel):
    vault_path: str
    force: bool = False
    excludes: Optional[List[str]] = None
    save_location_type: Optional[str] = "root"
    custom_save_path: Optional[str] = "/Generated"
    naming_convention: Optional[str] = "kebab"
    date_format: Optional[str] = "YYYY-MM-DD"
    frontmatter_keys: Optional[List[str]] = ["tags", "created", "source", "status"]
    style_preset: Optional[str] = "atomic"
    linking_depth: Optional[str] = "deep"
    auto_index_on_launch: Optional[bool] = True

@app.post("/indexer/scan")
async def scan_vault(req: ScanRequest):
    config = {
        "vault_path": req.vault_path,
        "save_location_type": req.save_location_type,
        "custom_save_path": req.custom_save_path,
        "naming_convention": req.naming_convention,
        "date_format": req.date_format,
        "frontmatter_keys": req.frontmatter_keys or ["tags", "created", "source", "status"],
        "style_preset": req.style_preset,
        "linking_depth": req.linking_depth,
        "auto_index_on_launch": req.auto_index_on_launch,
    }
    result = await indexer.scan_vault(
        req.vault_path,
        force=req.force,
        excludes=set(req.excludes) if req.excludes else None,
        config=config
    )
    return result

@app.get("/indexer/graph/neighbors")
async def get_neighbors(path: str = Query(..., description="Node path")):
    return indexer.get_neighbors(path)

@app.get("/indexer/graph/deep")
async def get_deep_links(
    path: str = Query(..., description="Root node path"),
    depth: Optional[int] = Query(None, description="Traversal depth")
):
    return indexer.get_deep_links(path, depth)

@app.get("/indexer/graph/orphans")
async def get_orphans():
    return {"orphans": indexer.get_orphans()}

@app.get("/indexer/graph/top")
async def get_top_nodes(limit: int = Query(10, description="Top nodes limit")):
    return {"top_nodes": indexer.get_top_nodes(limit)}

@app.get("/indexer/graph/nodes")
async def get_all_nodes():
    return {"nodes": indexer.get_all_nodes()}

@app.get("/indexer/read")
async def read_node(path: str = Query(..., description="Node path")):
    return await indexer.read_node_content(path)

# =====================================================================
# Pipeline Routes (Agent Orchestration & SSE Progress Stream)
# =====================================================================

@app.post("/pipeline/start", status_code=202)
async def start_pipeline(
    req: PipelineRunRequest,
    background_tasks: BackgroundTasks,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
    x_openrouter_key: Optional[str] = Header(None, alias="X-OpenRouter-Key"),
    x_tavily_key: Optional[str] = Header(None, alias="X-Tavily-Key"),
    x_firecrawl_key: Optional[str] = Header(None, alias="X-Firecrawl-Key")
):
    session_id = orchestrator.create_session(req)
    headers = {
        "x-gemini-key": x_gemini_key or "",
        "x-openrouter-key": x_openrouter_key or "",
        "x-tavily-key": x_tavily_key or "",
        "x-firecrawl-key": x_firecrawl_key or ""
    }
    task = asyncio.create_task(orchestrator.run_pipeline(session_id, req, headers))
    active_tasks[session_id] = task
    return {"session_id": session_id, "status": "accepted"}

@app.get("/pipeline/stream/{session_id}")
async def stream_pipeline_progress(session_id: str):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return StreamingResponse(
        orchestrator.get_event_stream(session_id),
        media_type="text/event-stream"
    )

@app.get("/pipeline/session/{session_id}")
async def get_pipeline_session(session_id: str):
    if session_id in active_sessions:
        return active_sessions[session_id]
    db_session = get_session(session_id)
    if db_session:
        return db_session
    raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

@app.post("/pipeline/session/{session_id}/commit")
async def commit_pipeline_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    req: Optional[SessionCommitRequest] = None
):
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    session = active_sessions[session_id]
    staged_raw = session.get("staged_files", [])
    
    # Reconstruct StagedFile list
    from schemas import StagedFile
    staged_objs = [StagedFile(**f) for f in staged_raw]
    
    req_obj = session["request"]
    if isinstance(req_obj, dict):
        vault_path = req_obj.get("vault_path")
        vault_id = req_obj.get("vault_id")
    else:
        vault_path = req_obj.vault_path
        vault_id = getattr(req_obj, "vault_id", None)

    res = await writer_agent.commit_staged_files(
        staged_files=staged_objs,
        selected_ids=req.selected_file_ids if req else None,
        vault_path=vault_path
    )
    
    session["status"] = "saved"
    update_session(session_id, status="saved")

    # Section 15 Memory Layer Trigger
    if vault_id:
        files_written = staged_objs
        if req and req.selected_file_ids:
            files_written = [f for f in staged_objs if f.id in req.selected_file_ids]
        
        committed_content = ""
        for f in files_written:
            committed_content += f"\n\n--- Note: {f.filename} ---\n{f.content}"
        
        if committed_content.strip():
            from memory import memory_engine
            keys = session.get("headers", {})
            background_tasks.add_task(
                memory_engine.extract_and_gate_facts,
                committed_content,
                vault_id,
                keys
            )
            print(f"[App] Scheduled memory fact-extraction task for vault: {vault_id}")

    return res

@app.post("/pipeline/session/{session_id}/discard")
async def discard_pipeline_session(session_id: str):
    if session_id in active_sessions:
        active_sessions[session_id]["status"] = "discarded"
    
    task = active_tasks.get(session_id)
    if task and not task.done():
        task.cancel()
        print(f"[App] Cancelled background task for session {session_id}")
        
    update_session(session_id, status="discarded")
    return {"status": "discarded", "session_id": session_id}

class StagedFileUpdateRequest(BaseModel):
    content: str
    filename: Optional[str] = None
    frontmatter: Optional[Dict[str, Any]] = None

class StagedFileRefineRequest(BaseModel):
    instruction: str
    urls: Optional[List[str]] = None

@app.post("/pipeline/session/{session_id}/file/{file_id}/update")
async def update_staged_file(session_id: str, file_id: str, req: StagedFileUpdateRequest):
    import os
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    
    session = active_sessions[session_id]
    staged_files = session.get("staged_files", [])
    
    found = False
    for f in staged_files:
        if f.get("id") == file_id:
            f["content"] = req.content
            if req.filename:
                f["filename"] = req.filename
                # Update paths based on new filename
                f["rel_path"] = os.path.join(os.path.dirname(f["rel_path"]), req.filename)
                f["full_target_path"] = os.path.join(os.path.dirname(f["full_target_path"]), req.filename)
            if req.frontmatter is not None:
                f["frontmatter"] = req.frontmatter
            found = True
            break
            
    if not found:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found in session")
        
    return {"status": "success"}

@app.post("/pipeline/session/{session_id}/file/{file_id}/refine")
async def refine_staged_file(
    session_id: str, 
    file_id: str, 
    req: StagedFileRefineRequest,
    x_gemini_key: Optional[str] = Header(None),
    x_openrouter_key: Optional[str] = Header(None)
):
    import os
    import httpx
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
    session = active_sessions[session_id]
    staged_files = session.get("staged_files", [])
    
    file_to_refine = None
    for f in staged_files:
        if f.get("id") == file_id:
            file_to_refine = f
            break
            
    if not file_to_refine:
        raise HTTPException(status_code=404, detail=f"File {file_id} not found in session")
        
    gemini_key = x_gemini_key or os.getenv("GEMINI_API_KEY")
    openrouter_key = x_openrouter_key or os.getenv("OPENROUTER_API_KEY")
    
    if not gemini_key and not openrouter_key:
        raise HTTPException(status_code=400, detail="API Key missing: Please provide a Gemini or OpenRouter key to run refinement.")
        
    current_content = file_to_refine.get("content", "")
    filename = file_to_refine.get("filename", "")
    
    # Scrape any appended URLs for refinement context
    scraped_context = ""
    if req.urls and len(req.urls) > 0:
        try:
            from agents.discovery import DiscoveryAgent
            discovery_agent = DiscoveryAgent()
            firecrawl_key = session.get("headers", {}).get("x-firecrawl-key", "") or os.getenv("FIRECRAWL_API_KEY", "")
            scrape_provider = "firecrawl" if firecrawl_key else "httpx"
            scraped_sources = await discovery_agent.scrape_urls_parallel(
                req.urls,
                scrape_provider=scrape_provider,
                firecrawl_key=firecrawl_key
            )
            for s in scraped_sources:
                if s.success:
                    scraped_context += f"\n\n--- Scraped Content from {s.url} ---\n{s.markdown_content}\n"
        except Exception as e:
            print(f"[Refine] Error scraping URLs: {e}")

    refinement_prompt = f"""
You are an expert technical writer editing a note in an Obsidian Zettelkasten vault.
You must refine/modify the following note according to the user's instructions.

Original File Name: {filename}
User's Instruction: {req.instruction}
"""

    if scraped_context:
        refinement_prompt += f"\n--- ADDITIONAL SCRAPED REFERENCE CONTEXT ---\n{scraped_context}\n"

    refinement_prompt += f"""
--- CURRENT NOTE CONTENT ---
{current_content}
----------------------------

Provide the COMPLETE updated body of the note. Do not add any conversational text, introductory statements, or explanation. Simply output the new content exactly as it should be saved.
Keep all YAML frontmatter if it exists at the top. Preserve all internal wiki-links [[wiki-links]] that are relevant.
"""
    
    refined_content = ""
    
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [{"parts": [{"text": refinement_prompt}]}],
                "generationConfig": {"maxOutputTokens": 2048}
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                    if raw_text.strip().startswith("```markdown"):
                        raw_text = raw_text.strip().split("```markdown", 1)[1].rsplit("```", 1)[0]
                    elif raw_text.strip().startswith("```"):
                        raw_text = raw_text.strip().split("```", 1)[1].rsplit("```", 1)[0]
                    refined_content = raw_text.strip()
                else:
                    raise Exception(f"Gemini API error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[Refine] Gemini call failed: {e}")
            
    if not refined_content and openrouter_key:
        try:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "google/gemini-2.5-flash",
                "messages": [{"role": "user", "content": refinement_prompt}],
                "max_tokens": 2048
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(url, json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    raw_text = data["choices"][0]["message"]["content"]
                    if raw_text.strip().startswith("```markdown"):
                        raw_text = raw_text.strip().split("```markdown", 1)[1].rsplit("```", 1)[0]
                    elif raw_text.strip().startswith("```"):
                        raw_text = raw_text.strip().split("```", 1)[1].rsplit("```", 1)[0]
                    refined_content = raw_text.strip()
                else:
                    raise Exception(f"OpenRouter API error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[Refine] OpenRouter call failed: {e}")
            
    if not refined_content:
        raise HTTPException(status_code=500, detail="Failed to generate refined content from AI provider.")
        
    file_to_refine["content"] = refined_content
    
    if refined_content.startswith("---"):
        parts = refined_content.split("---", 2)
        if len(parts) >= 3:
            import yaml
            try:
                fm = yaml.safe_load(parts[1])
                if isinstance(fm, dict):
                    file_to_refine["frontmatter"] = fm
            except:
                pass
                
    return file_to_refine

# =====================================================================
# Memory Routes (Section 15 Memory Layer)
# =====================================================================

@app.get("/memory")
async def get_memories(
    scope: Optional[str] = Query(None, description="vault|global"),
    vault_id: Optional[str] = Query(None, description="Target vault UUID")
):
    from database import list_memory_entries
    if scope == "vault" and not vault_id:
        raise HTTPException(status_code=400, detail="vault_id is required for vault scope")
    
    return {"memories": list_memory_entries(scope=scope, vault_id=vault_id)}

@app.delete("/memory/{id}")
async def delete_memory(id: str):
    from database import get_memory_entry, delete_memory_entry
    entry = get_memory_entry(id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Memory entry {id} not found")
    
    # Delete from vector cache
    scope = entry["scope"]
    vault_id = entry.get("vault_id")
    try:
        from memory import load_vectors, save_vectors
        vectors = load_vectors(scope, vault_id)
        vectors = [v for v in vectors if v["id"] != id]
        save_vectors(vectors, scope, vault_id)
    except Exception as e:
        print(f"[App] Error deleting memory from vector store: {e}")

    # Delete from SQLite
    delete_memory_entry(id)
    return {"status": "success", "deleted_id": id}

@app.post("/memory/{id}/confirm")
async def confirm_memory(id: str):
    from database import get_memory_entry, update_memory_status
    entry = get_memory_entry(id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Memory entry {id} not found")
    
    update_memory_status(id, "confirmed")
    return {"status": "success", "confirmed_id": id}

# =====================================================================
# History Routes (SQLite Persistence)
# =====================================================================

@app.get("/history/sessions")
async def get_history_sessions(limit: int = 50, offset: int = 0):
    return {"sessions": list_sessions(limit=limit, offset=offset)}

@app.get("/history/session/{session_id}")
async def get_history_session_detail(session_id: str):
    sess = get_session(session_id)
    if not sess:
        raise HTTPException(status_code=404, detail=f"History session {session_id} not found")
    return sess

# =====================================================================
# Settings Connection Test Endpoint
# =====================================================================

@app.post("/settings/test-key")
async def test_api_key(req: KeyTestRequest):
    if not req.api_key.strip():
        return {"valid": False, "message": "Key cannot be empty"}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            if req.provider == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models?key={req.api_key}"
                res = await client.get(url)
                if res.status_code == 200:
                    return {"valid": True, "message": "Gemini API Key is valid!"}
                return {"valid": False, "message": f"Gemini API Error {res.status_code}: {res.text[:100]}"}

            elif req.provider == "tavily":
                url = "https://api.tavily.com/search"
                res = await client.post(url, json={"api_key": req.api_key, "query": "test"})
                if res.status_code in (200, 400): # 200 or 400 valid key response
                    return {"valid": True, "message": "Tavily API Key is valid!"}
                return {"valid": False, "message": f"Tavily API Error {res.status_code}"}

            elif req.provider == "firecrawl":
                url = "https://api.firecrawl.dev/v1/scrape"
                res = await client.post(url, json={"url": "https://example.com"}, headers={"Authorization": f"Bearer {req.api_key}"})
                if res.status_code in (200, 402, 429): # Valid auth header
                    return {"valid": True, "message": "Firecrawl API Key connection established!"}
                return {"valid": False, "message": f"Firecrawl API Error {res.status_code}"}

            elif req.provider == "openrouter":
                url = "https://openrouter.ai/api/v1/models"
                res = await client.get(url, headers={"Authorization": f"Bearer {req.api_key}"})
                if res.status_code == 200:
                    return {"valid": True, "message": "OpenRouter Key is valid!"}
                return {"valid": False, "message": f"OpenRouter API Error {res.status_code}"}
        except Exception as e:
            return {"valid": False, "message": f"Connection failed: {str(e)}"}


if __name__ == "__main__":
    import os
    port = 5000
    
    # Read environment variable
    if "PORT" in os.environ:
        try:
            port = int(os.environ["PORT"])
        except ValueError:
            pass

    # Read command line arguments
    for arg in sys.argv:
        if arg.startswith("--port="):
            try:
                port = int(arg.split("=")[1])
            except ValueError:
                pass

    # If port is 0, let's find a free local port dynamically
    if port == 0:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
        s.close()
        print(f"INFO: Allocated dynamic port: {port}")
        sys.stdout.flush()

    if getattr(sys, 'frozen', False):
        uvicorn.run(app, host="127.0.0.1", port=port)
    else:
        uvicorn.run("app:app", host="127.0.0.1", port=port, reload=(port == 5000))
