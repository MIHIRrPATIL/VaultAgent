import asyncio
import os
import uuid
import json
from datetime import datetime, timezone
from typing import Dict, Any, Optional, AsyncGenerator

from schemas import (
    PipelineRunRequest,
    PipelineProgressEvent,
    StagedFile,
    ResearchOutput
)
from database import save_session, update_session
from indexer import indexer
from agents.discovery import discovery_agent
from agents.linker import linker_agent
from agents.writer import writer_agent

# In-memory store for active session states and SSE queues
active_sessions: Dict[str, Dict[str, Any]] = {}
session_queues: Dict[str, asyncio.Queue] = {}

class PipelineOrchestrator:
    def create_session(self, request: PipelineRunRequest) -> str:
        session_id = str(uuid.uuid4())
        active_sessions[session_id] = {
            "session_id": session_id,
            "request": request.model_dump(),
            "status": "pending",
            "stage": "indexer",
            "staged_files": [],
            "research_output": None,
            "synthesis_result": None,
            "error": None
        }
        session_queues[session_id] = asyncio.Queue()
        
        # Persist session metadata in SQLite
        save_session(
            session_id=session_id,
            prompt=request.prompt,
            mode=request.mode,
            style_preset=request.style_preset,
            length=request.length,
            linking_depth=request.linking_depth,
            status="pending",
            output_files_count=0
        )
        
        return session_id

    async def emit_event(
        self,
        session_id: str,
        stage: str,
        event_type: str,
        message: str,
        progress: int,
        data: Optional[Dict[str, Any]] = None
    ):
        event = PipelineProgressEvent(
            session_id=session_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            stage=stage,
            event_type=event_type,
            message=message,
            progress_percent=progress,
            data=data
        )
        
        if session_id in session_queues:
            await session_queues[session_id].put(event)

    async def run_pipeline(self, session_id: str, request: PipelineRunRequest, headers: Dict[str, str]):
        """Executes 4-agent sequential pipeline in background task."""
        if session_id not in active_sessions:
            return

        session = active_sessions[session_id]
        session["status"] = "running"
        session["headers"] = headers

        # Extract API keys from headers with env fallbacks
        gemini_key = headers.get("x-gemini-key") or headers.get("X-Gemini-Key") or os.getenv("GEMINI_API_KEY")
        openrouter_key = headers.get("x-openrouter-key") or headers.get("X-OpenRouter-Key") or os.getenv("OPENROUTER_API_KEY")
        tavily_key = headers.get("x-tavily-key") or headers.get("X-Tavily-Key") or os.getenv("TAVILY_API_KEY")
        firecrawl_key = headers.get("x-firecrawl-key") or headers.get("X-Firecrawl-Key") or os.getenv("FIRECRAWL_API_KEY")

        try:
            # -------------------------------------------------------------
            # Stage 1: Indexing & Subgraph Selection
            # -------------------------------------------------------------
            session["stage"] = "indexer"
            await self.emit_event(session_id, "indexer", "stage_start", "Indexing vault graph and extracting candidate notes...", 5)
            
            # Run incremental scan on target vault if needed
            await indexer.scan_vault(request.vault_path, force=False)
            subgraph = linker_agent.extract_vault_subgraph(indexer, request.prompt, depth=request.linking_depth)
            
            await self.emit_event(
                session_id, "indexer", "stage_complete",
                f"Extracted {len(subgraph.candidate_notes)} candidate notes from vault graph.",
                20
            )

            # -------------------------------------------------------------
            # Stage 2: Web Discovery & Research (Or Bypass if Raw Convert)
            # -------------------------------------------------------------
            session["stage"] = "discovery"
            research_context = ""
            
            if request.mode == "raw_convert":
                await self.emit_event(session_id, "discovery", "stage_start", "Raw Note Conversion mode selected — bypassing web search.", 30)
                if request.raw_drafts:
                    research_context = "\n\n---\n\n".join(request.raw_drafts)
                else:
                    research_context = request.prompt
                await self.emit_event(session_id, "discovery", "stage_complete", "Loaded raw draft text for synthesis.", 40)
            else:
                await self.emit_event(session_id, "discovery", "stage_start", f"Initiating web research for topic '{request.prompt}'...", 25)
                
                async def progress_cb(msg: str, pct: int):
                    await self.emit_event(session_id, "discovery", "stage_progress", msg, pct)

                research_res = await discovery_agent.execute_research(
                    topic=request.prompt,
                    user_urls=request.urls,
                    search_provider=request.search_provider,
                    scrape_provider=request.scrape_provider,
                    tavily_key=tavily_key,
                    openrouter_key=openrouter_key,
                    gemini_key=gemini_key,
                    firecrawl_key=firecrawl_key,
                    progress_callback=progress_cb
                )
                session["research_output"] = research_res.model_dump()
                research_context = research_res.combined_deduped_context
                if not research_context.strip():
                    research_context = request.prompt

                await self.emit_event(session_id, "discovery", "stage_complete", f"Retrieved source content from {research_res.sources_succeeded} sources.", 50)

            # -------------------------------------------------------------
            # Stage 3: Linker & Synthesis Agent
            # -------------------------------------------------------------
            session["stage"] = "linker"
            await self.emit_event(session_id, "linker", "stage_start", f"Synthesizing Markdown notes with style preset '{request.style_preset}'...", 55)

            memory_guidelines = ""
            if request.vault_id:
                try:
                    from memory import memory_engine
                    # Query both vault-scoped and global scope memories
                    vault_memories = await memory_engine.proactive_context(
                        prompt=request.prompt,
                        scope="vault",
                        vault_id=request.vault_id,
                        gemini_key=gemini_key,
                        semantic_threshold=0.65,
                        max_results=5
                    )
                    global_memories = await memory_engine.proactive_context(
                        prompt=request.prompt,
                        scope="global",
                        vault_id=request.vault_id,
                        gemini_key=gemini_key,
                        semantic_threshold=0.65,
                        max_results=3
                    )
                    # Merge: vault-scoped memories win priority
                    merged_memories = vault_memories + global_memories
                    if merged_memories:
                        memory_guidelines_str = "\n- ".join(merged_memories)
                        memory_guidelines = f"\n\n### User Memory & Preferences:\n- {memory_guidelines_str}"
                        print(f"[PipelineOrchestrator] Injected memory context: {memory_guidelines}")
                except Exception as e:
                    print(f"[PipelineOrchestrator] Error loading memory context: {e}")

            draft_notes = await linker_agent.generate_llm_synthesis(
                prompt=request.prompt,
                research_context=research_context + memory_guidelines,
                subgraph=subgraph,
                style_preset=request.style_preset,
                length=request.length,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key
            )

            await self.emit_event(session_id, "linker", "stage_progress", f"Generated {len(draft_notes)} draft notes. Validating wiki-links against graph...", 75)

            synthesis_result = linker_agent.validate_and_sanitize_links(draft_notes, indexer)
            session["synthesis_result"] = synthesis_result.model_dump()

            await self.emit_event(
                session_id, "linker", "stage_complete",
                f"Validated {synthesis_result.validated_links_count} wiki-links across {len(synthesis_result.notes)} notes.",
                85
            )

            # -------------------------------------------------------------
            # Stage 4: Writer Agent (Staging)
            # -------------------------------------------------------------
            session["stage"] = "writer"
            await self.emit_event(session_id, "writer", "stage_start", "Applying YAML frontmatter and formatting staged files...", 90)

            staged_files = await writer_agent.stage_notes(
                drafts=synthesis_result.notes,
                vault_path=request.vault_path,
                save_subfolder=request.custom_save_path or "/Generated",
                naming_convention=request.naming_convention or "kebab",
                date_format=request.date_format or "YYYY-MM-DD",
                frontmatter_keys=request.frontmatter_keys,
                style_preset=request.style_preset,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key
            )

            session["staged_files"] = [f.model_dump() for f in staged_files]
            session["status"] = "staged"

            update_session(
                session_id=session_id,
                status="staged",
                output_files_count=len(staged_files),
                session_payload=session
            )

            await self.emit_event(
                session_id, "completed", "pipeline_complete",
                f"Pipeline execution completed successfully. {len(staged_files)} files ready for review.",
                100,
                data={"staged_files": [f.model_dump() for f in staged_files]}
            )

        except asyncio.CancelledError:
            print(f"[PipelineOrchestrator] Session {session_id} was cancelled.")
            session["status"] = "discarded"
            update_session(session_id=session_id, status="discarded")
            await self.emit_event(session_id, "error", "error", "Pipeline execution cancelled by user.", 0)
            raise
        except Exception as e:
            print(f"[PipelineOrchestrator] Error in session {session_id}: {e}")
            session["status"] = "failed"
            session["error"] = str(e)
            update_session(session_id=session_id, status="failed")
            await self.emit_event(session_id, "error", "error", f"Pipeline failed: {str(e)}", 0)

    async def get_event_stream(self, session_id: str) -> AsyncGenerator[str, None]:
        """Async generator emitting Server-Sent Events (SSE)."""
        if session_id not in session_queues:
            return

        queue = session_queues[session_id]
        while True:
            try:
                event: PipelineProgressEvent = await queue.get()
                yield f"data: {event.model_dump_json()}\n\n"
                if event.event_type in ("pipeline_complete", "error"):
                    break
            except asyncio.CancelledError:
                break

orchestrator = PipelineOrchestrator()
