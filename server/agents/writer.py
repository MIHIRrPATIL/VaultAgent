import os
import re
import yaml
import asyncio
import httpx
import random
from datetime import datetime
from typing import List, Dict, Any, Optional
import aiofiles
from indexer import indexer
from schemas import SynthesizedNoteDraft, StagedFile

class WriterAgent:
    def format_filename(self, name: str, convention: str = "kebab") -> str:
        """Formats filename according to naming convention setting."""
        clean = re.sub(r'[^\w\s-]', '', name).strip()
        if convention == "kebab":
            return re.sub(r'[\s_]+', '-', clean).lower()
        elif convention == "title":
            return clean.title()
        elif convention == "timestamp":
            ts = datetime.now().strftime("%Y%m%d%H%M")
            kebab = re.sub(r'[\s_]+', '-', clean).lower()
            return f"{ts}-{kebab}"
        return clean

    async def stage_notes(
        self,
        drafts: List[SynthesizedNoteDraft],
        vault_path: str,
        save_subfolder: str = "/Generated",
        naming_convention: str = "kebab",
        date_format: str = "YYYY-MM-DD",
        frontmatter_keys: Optional[List[str]] = None,
        style_preset: str = "atomic",
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None
    ) -> List[StagedFile]:
        """Prepares StagedFile objects for review prior to writing to disk (FR-5.5)."""
        if frontmatter_keys is None:
            frontmatter_keys = ["tags", "created", "source", "status"]

        # Run polishing passes concurrently if API keys are available
        polishing_tasks = []
        for draft in drafts:
            polishing_tasks.append(
                self._polish_note_style(
                    draft.title,
                    draft.body_markdown,
                    style_preset,
                    gemini_key,
                    openrouter_key
                )
            )
        
        polished_bodies = await asyncio.gather(*polishing_tasks)

        staged_files = []
        target_dir = os.path.join(vault_path, save_subfolder.strip("/"))
        
        for idx, draft in enumerate(drafts):
            filename_base = self.format_filename(draft.suggested_filename or draft.title, naming_convention)
            filename = f"{filename_base}.md"
            rel_path = os.path.join(save_subfolder.strip("/"), filename)
            full_target_path = os.path.join(target_dir, filename)

            # Detect collision against disk
            has_collision = os.path.exists(full_target_path)
            
            # Format frontmatter dictionary
            today_str = datetime.now().strftime("%Y-%m-%d" if date_format == "YYYY-MM-DD" else "%Y-%m-%dT%H:%M:%S")
            fm_data = {}
            if "tags" in frontmatter_keys:
                fm_data["tags"] = draft.tags
            if "created" in frontmatter_keys:
                fm_data["created"] = today_str
            if "source" in frontmatter_keys:
                fm_data["source"] = "VaultAgent"
            if "status" in frontmatter_keys:
                fm_data["status"] = "draft"
            if draft.aliases:
                fm_data["aliases"] = draft.aliases

            yaml_header = "---\n" + yaml.dump(fm_data, sort_keys=False) + "---\n\n"
            
            # Use polished content if available, fallback to draft body markdown
            polished_body = polished_bodies[idx]
            full_content = yaml_header + polished_body

            staged_files.append(StagedFile(
                id=f"staged-{idx}",
                filename=filename,
                rel_path=rel_path,
                full_target_path=full_target_path,
                frontmatter=fm_data,
                content=full_content,
                has_collision=has_collision,
                collision_action="disambiguate" if has_collision else "overwrite"
            ))

        return staged_files

    async def _polish_note_style(
        self,
        title: str,
        body_markdown: str,
        style_preset: str,
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None
    ) -> str:
        """Uses Gemini/OpenRouter to polish note body formatting based on style preset, keeping all links intact."""
        if not gemini_key and not openrouter_key:
            return body_markdown

        # Build prompt based on style preset
        style_instructions = ""
        if style_preset == "atomic":
            style_instructions = (
                "- Structure the note modularly (focused on a single concept).\n"
                "- Start the note with a clean, concise Obsidian callout summary block:\n"
                "  > [!ABSTRACT] Quick Summary\n"
                "  > Brief summary of the core concept...\n"
                "- Use clear bullet points and short paragraphs for readability.\n"
            )
        elif style_preset == "essay":
            style_instructions = (
                "- Use a clean heading hierarchy (H2, H3) for different sections.\n"
                "- Employ blockquotes and horizontal rules (`---`) to separate thoughts.\n"
                "- Focus on narrative flow with well-formed, readable paragraphs.\n"
            )
        elif style_preset == "technical":
            style_instructions = (
                "- Include clear definitions and concept lists.\n"
                "- Use markdown tables to structure key parameters, metrics, or comparisons if applicable.\n"
                "- Ensure code blocks include appropriate language syntax highlighting.\n"
                "- Use informative Obsidian callouts strategically (e.g. `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`).\n"
            )

        # Extract wiki-links to instruct the model to preserve them
        wiki_links = re.findall(r'(\[\[[^\]]+\]\])', body_markdown)
        links_instruction = ""
        if wiki_links:
            links_list = ", ".join(set(wiki_links))
            links_instruction = (
                f"You MUST preserve these exact double-bracket wiki-links: {links_list}.\n"
                f"Ensure they are spelled exactly the same and appear in the final formatted note.\n"
            )

        prompt = (
            f"You are a Markdown Beautifier and Obsidian Layout Designer. Your job is to format the given note body text "
            f"to make it highly readable and visually stunning in Obsidian.\n\n"
            f"Style Preset: {style_preset.upper()}\n"
            f"Instructions:\n"
            f"{style_instructions}"
            f"CRITICAL RULES:\n"
            f"1. Do NOT rewrite the text from scratch or search your own knowledge to write new paragraphs. Maintain the exact same sentences, facts, and structure from the draft note. Only add layout formatting (such as bullet lists, bold text, italics, headers, code highlight blocks, or callouts) to improve visual presentation.\n"
            f"2. {links_instruction}"
            f"3. Do NOT add new links to terms that were not already linked in the draft note.\n"
            f"4. Return ONLY the polished markdown content. Do not wrap it in markdown code blocks or add any explanations.\n\n"
            f"Draft note content to format:\n"
            f"{body_markdown}"
        )

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    if gemini_key:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                        body = {"contents": [{"parts": [{"text": prompt}]}]}
                        res = await client.post(url, json=body)
                        if res.status_code == 200:
                            data = res.json()
                            content = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                            if content:
                                return content
                        elif res.status_code == 429:
                            backoff = (2 ** attempt) + random.uniform(0.1, 1.0)
                            await asyncio.sleep(backoff)
                        else:
                            print(f"[WriterAgent] Gemini polishing error {res.status_code}: {res.text}")
                            break
                    elif openrouter_key:
                        url = "https://openrouter.ai/api/v1/chat/completions"
                        headers = {
                            "Authorization": f"Bearer {openrouter_key}",
                            "Content-Type": "application/json"
                        }
                        body = {
                            "model": "google/gemini-2.5-flash",
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.2,
                            "max_tokens": 4096
                        }
                        res = await client.post(url, json=body, headers=headers)
                        if res.status_code == 200:
                            data = res.json()
                            content = data["choices"][0]["message"]["content"].strip()
                            if content:
                                return content
                        elif res.status_code == 429:
                            backoff = (2 ** attempt) + random.uniform(0.1, 1.0)
                            await asyncio.sleep(backoff)
                        else:
                            print(f"[WriterAgent] OpenRouter polishing error {res.status_code}: {res.text}")
                            break
            except Exception as e:
                print(f"[WriterAgent] Polishing attempt {attempt + 1} exception: {e}")
                await asyncio.sleep(1.0)

        # Fallback to original text if LLM call fails
        return body_markdown

    async def commit_staged_files(
        self,
        staged_files: List[StagedFile],
        selected_ids: Optional[List[str]] = None,
        vault_path: str = ""
    ) -> Dict[str, Any]:
        """Writes reviewed staged files to disk and triggers vault graph update (FR-5.6)."""
        written_paths = []
        files_to_write = staged_files
        
        if selected_ids:
            files_to_write = [f for f in staged_files if f.id in selected_ids]

        for file in files_to_write:
            target_path = file.full_target_path
            
            # Disambiguate if collision
            if file.has_collision and file.collision_action == "disambiguate":
                base, ext = os.path.splitext(target_path)
                ts = datetime.now().strftime("%H%M%S")
                target_path = f"{base}-{ts}{ext}"

            # Create target directory if needed
            os.makedirs(os.path.dirname(target_path), exist_ok=True)

            async with aiofiles.open(target_path, "w", encoding="utf-8") as f:
                await f.write(file.content)
            
            written_paths.append(target_path)

        # Incrementally update indexer graph
        scan_res = {}
        if vault_path and os.path.exists(vault_path):
            scan_res = await indexer.scan_vault(vault_path, force=False)

        return {
            "status": "success",
            "saved_files": written_paths,
            "indexer_result": scan_res
        }

writer_agent = WriterAgent()
