import os
import json
import uuid
import re
import httpx
from typing import List, Dict, Any, Optional
from database import add_memory_entry, list_memory_entries, update_memory_status
from embeddings import get_embedding, cosine_similarity

class MemoryEngine:
    async def get_embedding(
        self,
        text: str,
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None
    ) -> List[float]:
        """Wrapper method delegating to the shared embeddings module."""
        return await get_embedding(text, gemini_key=gemini_key, openrouter_key=openrouter_key)

    async def remember(
        self,
        content: str,
        scope: str,
        vault_id: Optional[str] = None,
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None,
        memory_type: Optional[str] = None,
        tags: Optional[List[str]] = None,
        confidence: float = 1.0,
        status: str = "pending"
    ) -> str:
        """Stores a new fact directly in the SQLite database with its embedding vector."""
        entry_id = str(uuid.uuid4())
        
        # Generate embedding vector
        vector = await self.get_embedding(content, gemini_key=gemini_key, openrouter_key=openrouter_key)
        vector_json = json.dumps(vector)
        
        # Add to SQLite DB
        add_memory_entry(
            id=entry_id,
            scope=scope,
            vault_id=vault_id,
            content=content,
            memory_type=memory_type,
            tags=tags,
            confidence=confidence,
            status=status,
            vector_json=vector_json
        )
        
        return entry_id

    async def proactive_context(
        self,
        prompt: str,
        scope: str,
        vault_id: Optional[str] = None,
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None,
        semantic_threshold: float = 0.65,
        max_results: int = 5
    ) -> List[str]:
        """Performs semantic similarity query returning matching memory strings."""
        active_entries = list_memory_entries(scope=scope, vault_id=vault_id)
        # Filter only pending or confirmed entries
        active_entries = [e for e in active_entries if e["status"] in ("pending", "confirmed")]
        if not active_entries:
            return []

        # Generate prompt embedding
        prompt_vec = await self.get_embedding(prompt, gemini_key=gemini_key, openrouter_key=openrouter_key)
        
        # Check if we have valid embeddings (i.e. not all zero fallback)
        has_real_embeddings = any(e.get("vector_json") is not None for e in active_entries) and any(val != 0.0 for val in prompt_vec)

        scored = []
        if has_real_embeddings:
            for entry in active_entries:
                vec_str = entry.get("vector_json")
                if not vec_str:
                    continue
                try:
                    vec = json.loads(vec_str)
                    sim = cosine_similarity(prompt_vec, vec)
                    if sim >= semantic_threshold:
                        scored.append((sim, entry["content"]))
                except Exception:
                    continue
            scored.sort(key=lambda x: x[0], reverse=True)
            return [text for _, text in scored[:max_results]]
        else:
            # Simple keyword matching fallback if offline or no keys
            words = set(re.findall(r'\w+', prompt.lower()))
            for entry in active_entries:
                v_words = set(re.findall(r'\w+', entry["content"].lower()))
                overlap = len(words.intersection(v_words)) / max(len(words), 1)
                if overlap > 0.10: # Low threshold for keyword match
                    scored.append((overlap, entry["content"]))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [text for _, text in scored[:max_results]]

    async def extract_and_gate_facts(
        self,
        note_content: str,
        vault_id: str,
        keys: Dict[str, str]
    ):
        """Asynchronously extracts structured facts from a newly written note, performs contradiction check, and saves."""
        gemini_key = keys.get("x-gemini-key") or keys.get("geminiKey")
        openrouter_key = keys.get("x-openrouter-key") or keys.get("openrouterKey")
        
        if not gemini_key and not openrouter_key:
            print("[MemoryEngine] No LLM keys supplied for fact extraction. Skipping.")
            return
 
        prompt = (
            f"Content of Note:\n{note_content}\n\n"
            "Task: Extract any persistent user preferences, technical choices, and recurrent guidelines "
            "revealed in this note that would be useful to remember across sessions.\n"
            "Ignore trivial info. Return a JSON array matching this schema:\n"
            "[\n"
            "  {\n"
            "    \"content\": \"Prefers python for scripting\",\n"
            "    \"scope\": \"global\" or \"vault\",\n"
            "    \"memory_type\": \"Preference\",\n"
            "    \"confidence\": 0.90\n"
            "  }\n"
            "]\n"
            "Classification rule:\n"
            "- 'global': General style, tone, format, or high-level tech preferences.\n"
            "- 'vault': Specific tech stack, terminology, projects, or entities matching this vault's domain.\n"
            "- Default to 'vault' scope if ambiguous or context-dependent.\n"
            "If nothing of durable value is found, return an empty array []."
        )

        extracted_facts = []
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                if openrouter_key:
                    headers = {
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json"
                    }
                    body = {
                        "model": "google/gemini-2.5-flash",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 1000
                    }
                    res = await client.post("https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers)
                    if res.status_code == 200:
                        raw = res.json()["choices"][0]["message"]["content"].strip()
                        # Extract JSON array
                        match = re.search(r'\[\s*\{.*\}\s*\]', raw, re.DOTALL)
                        if match:
                            extracted_facts = json.loads(match.group(0))
                        elif "[]" in raw:
                            extracted_facts = []
                elif gemini_key:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                    body = {"contents": [{"parts": [{"text": prompt}]}]}
                    res = await client.post(url, json=body)
                    if res.status_code == 200:
                        raw = res.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                        match = re.search(r'\[\s*\{.*\}\s*\]', raw, re.DOTALL)
                        if match:
                            extracted_facts = json.loads(match.group(0))
                        elif "[]" in raw:
                            extracted_facts = []
        except Exception as e:
            print(f"[MemoryEngine] Fact extraction failed: {e}")
            return

        for fact in extracted_facts:
            content = fact.get("content", "").strip()
            scope = fact.get("scope", "vault").strip()
            mem_type = fact.get("memory_type", "Preference").strip()
            confidence = fact.get("confidence", 1.0)
            
            if not content or confidence < 0.60:
                continue

            # Check if this scope is valid
            if scope not in ("global", "vault"):
                scope = "vault"

            # Check duplication / contradiction
            await self._handle_duplicate_or_contradiction(
                content=content,
                scope=scope,
                vault_id=vault_id,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key,
                memory_type=mem_type
            )

    async def _verify_fact_with_llm(
        self,
        new_fact: str,
        candidates: List[Dict[str, Any]],
        gemini_key: Optional[str],
        openrouter_key: Optional[str]
    ) -> str:
        """Calls the LLM in a single verify run to check contradiction/duplicate/novel classification."""
        candidates_str = "\n".join([
            f"- ID: {c['id']} | Fact: {c['content']}"
            for c in candidates
        ])

        prompt = (
            f"New Fact: {new_fact}\n\n"
            "Existing Facts:\n"
            f"{candidates_str}\n\n"
            "Task: Compare the New Fact against the list of Existing Facts and determine if it contradicts, duplicates, or is novel.\n"
            "Rules:\n"
            "1. If the New Fact directly contradicts or overrides an Existing Fact (e.g. 'likes dark theme' vs 'likes light theme'), output exactly 'CONTRADICT [ID]' where [ID] is the ID of the contradicted fact.\n"
            "2. If the New Fact duplicates or repeats an Existing Fact (e.g. 'prefers python' vs 'prefers python language'), output exactly 'DUPLICATE'.\n"
            "3. If the New Fact is novel and does not contradict or duplicate any existing facts, output exactly 'NOVEL'.\n"
            "Output ONLY the single classification string (e.g., 'CONTRADICT 123-abc' or 'DUPLICATE' or 'NOVEL') with no explanation."
        )

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                if openrouter_key:
                    headers = {
                        "Authorization": f"Bearer {openrouter_key}",
                        "Content-Type": "application/json"
                    }
                    body = {
                        "model": "google/gemini-2.5-flash",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 1000
                    }
                    res = await client.post("https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers)
                    if res.status_code == 200:
                        return res.json()["choices"][0]["message"]["content"].strip()
                elif gemini_key:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                    body = {"contents": [{"parts": [{"text": prompt}]}]}
                    res = await client.post(url, json=body)
                    if res.status_code == 200:
                        return res.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            print(f"[MemoryEngine] Contradiction LLM check exception: {e}")
            
        return "NOVEL"

    async def _handle_duplicate_or_contradiction(
        self,
        content: str,
        scope: str,
        vault_id: str,
        gemini_key: Optional[str],
        openrouter_key: Optional[str],
        memory_type: str
    ):
        """Checks if fact contradicts or duplicates existing facts using Retrieve-then-Verify pattern."""
        existing_entries = list_memory_entries(scope=scope, vault_id=vault_id)
        active_entries = [e for e in existing_entries if e["status"] in ("pending", "confirmed")]
        
        if not active_entries:
            # Safe to insert
            await self.remember(
                content=content,
                scope=scope,
                vault_id=vault_id,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key,
                memory_type=memory_type,
                status="pending"
            )
            return

        # 1. Retrieve candidates: Get top-K similarity matches (embeddings or BM25)
        new_vec = await self.get_embedding(content, gemini_key=gemini_key, openrouter_key=openrouter_key)
        has_real_embeddings = any(e.get("vector_json") is not None for e in active_entries) and any(val != 0.0 for val in new_vec)

        scored = []
        if has_real_embeddings:
            for entry in active_entries:
                vec_str = entry.get("vector_json")
                if not vec_str:
                    continue
                try:
                    vec = json.loads(vec_str)
                    sim = cosine_similarity(new_vec, vec)
                    scored.append((sim, entry))
                except Exception:
                    continue
        else:
            # BM25 / Keyword overlap similarity
            words = set(re.findall(r'\w+', content.lower()))
            for entry in active_entries:
                entry_words = set(re.findall(r'\w+', entry["content"].lower()))
                overlap = len(words.intersection(entry_words)) / max(len(words), 1)
                scored.append((overlap, entry))

        # Sort and take top 5 candidates
        scored.sort(key=lambda x: x[0], reverse=True)
        candidates = [item[1] for item in scored[:5]]

        if not candidates:
            await self.remember(
                content=content,
                scope=scope,
                vault_id=vault_id,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key,
                memory_type=memory_type,
                status="pending"
            )
            return

        # 2. Verify with LLM in a single call
        verification_result = await self._verify_fact_with_llm(
            new_fact=content,
            candidates=candidates,
            gemini_key=gemini_key,
            openrouter_key=openrouter_key
        )

        # 3. Action based on classification
        if "CONTRADICT" in verification_result:
            parts = verification_result.split()
            if len(parts) > 1:
                contradicted_id = parts[1].strip()
                print(f"[MemoryEngine] Contradiction detected. Dismissing old fact ID: '{contradicted_id}' in favor of new: '{content}'")
                update_memory_status(contradicted_id, "dismissed")
            
            await self.remember(
                content=content,
                scope=scope,
                vault_id=vault_id,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key,
                memory_type=memory_type,
                status="pending"
            )
        elif "DUPLICATE" in verification_result:
            print(f"[MemoryEngine] Duplicate detected. Discarding fact: '{content}'")
        else:
            await self.remember(
                content=content,
                scope=scope,
                vault_id=vault_id,
                gemini_key=gemini_key,
                openrouter_key=openrouter_key,
                memory_type=memory_type,
                status="pending"
            )

memory_engine = MemoryEngine()
