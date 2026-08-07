import re
import json
from typing import List, Dict, Any, Optional
import httpx
from indexer import VaultIndexer
from schemas import (
    VaultSubgraphPayload,
    CandidateNoteSummary,
    SynthesizedNoteDraft,
    SynthesisResult,
    ProposedWikiLink
)

class LinkerSynthesisAgent:
    def extract_vault_subgraph(self, indexer: VaultIndexer, query: str, depth: str = "deep", limit: int = 15) -> VaultSubgraphPayload:
        """Extracts candidate notes from NetworkX graph matching query or keywords."""
        query_words = set(re.findall(r'\w+', query.lower()))
        candidate_nodes = []

        all_aliases = list(indexer.alias_map.keys()) + [n for n in indexer.graph.nodes()]

        for node, data in indexer.graph.nodes(data=True):
            if not data.get("is_existing_file", True):
                continue
            
            # Match score based on filename, tags, or frontmatter
            node_lower = node.lower()
            score = 0
            for qw in query_words:
                if len(qw) > 2 and qw in node_lower:
                    score += 3
            
            tags = data.get("tags", [])
            for tag in tags:
                if any(qw in tag.lower() for qw in query_words if len(qw) > 2):
                    score += 2

            headings = data.get("headings", [])
            excerpt = ""
            if headings:
                excerpt = "Headings: " + ", ".join([h.get("text", "") for h in headings[:3]])

            if score > 0 or len(candidate_nodes) < limit:
                candidate_nodes.append((score, CandidateNoteSummary(
                    canonical_path=node,
                    filename=node.split("/")[-1],
                    frontmatter=data.get("frontmatter", {}),
                    tags=tags,
                    headings=headings,
                    excerpt=excerpt,
                    in_degree=indexer.graph.in_degree(node),
                    out_degree=indexer.graph.out_degree(node)
                )))

        # Sort candidate notes by match score & in_degree
        candidate_nodes.sort(key=lambda x: (x[0], x[1].in_degree), reverse=True)
        selected_candidates = [c[1] for c in candidate_nodes[:limit]]

        cutoff_depth = 3 if depth == "deep" else 1

        return VaultSubgraphPayload(
            vault_path=indexer.config.get("vault_path", ""),
            target_depth=cutoff_depth,
            candidate_notes=selected_candidates,
            all_indexed_aliases=list(set(all_aliases))
        )

    async def generate_llm_synthesis(
        self,
        prompt: str,
        research_context: str,
        subgraph: VaultSubgraphPayload,
        style_preset: str = "atomic",
        length: str = "medium",
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None
    ) -> List[SynthesizedNoteDraft]:
        """Calls Gemini / OpenRouter API to synthesize interlinked markdown notes."""
        
        candidates_str = "\n".join([
            f"- Note Name: [[{c.canonical_path}]] | Tags: {c.tags} | {c.excerpt}"
            for c in subgraph.candidate_notes
        ])

        system_instruction = f"""
You are an expert Obsidian Knowledge Assistant. Your job is to take raw research/draft material and write clean, high-quality, interlinked Markdown notes.

### Rules & Formatting:
1. Include double bracket wiki-links e.g. [[Note Name]] or [[Note Name|Alias]] whenever referencing concepts that exist in the user's vault.
2. Use existing note names from the CANDIDATE VAULT NOTES list whenever applicable:
{candidates_str}

3. Style Preset: {style_preset.upper()}
   - If ATOMIC: Generate modular Zettelkasten-style notes focused on single concepts, plus a central Map of Content (MOC) note linking to them.
   - If ESSAY: Generate one structured, comprehensive long-form essay with interlinked sections.
   - If TECHNICAL: Generate structured technical documentation with code blocks, callouts, and specifications.

4. Output MUST be valid JSON conforming to this schema:
[
  {{
    "title": "Title of Note",
    "suggested_filename": "kebab-case-title",
    "body_markdown": "Full Markdown content with [[wiki-links]]...",
    "tags": ["tag1", "tag2"],
    "aliases": ["Alias 1", "Alias 2"],
    "is_moc": false
  }}
]
"""

        user_content = f"""
USER INSTRUCTION: {prompt}
TARGET OUTPUT LENGTH: {length}

SOURCE RESEARCH CONTENT:
{research_context[:6000]}
"""

        # Call Gemini API if key is present
        if gemini_key:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [
                    {"role": "user", "parts": [{"text": system_instruction + "\n\n" + user_content}]}
                ],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.3
                }
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                try:
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        res_data = res.json()
                        raw_json_text = res_data["candidates"][0]["content"]["parts"][0]["text"]
                        return self._parse_json_notes(raw_json_text, prompt, research_context)
                    else:
                        print(f"[LinkerAgent] Gemini API Error {res.status_code}: {res.text}")
                except Exception as e:
                    print(f"[LinkerAgent] Gemini API Exception: {e}")

        # Call OpenRouter fallback if key present
        if openrouter_key:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"}
            payload = {
                "model": "google/gemini-2.5-flash",
                "messages": [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_content}
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 4096
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                try:
                    res = await client.post(url, json=payload, headers=headers)
                    if res.status_code == 200:
                        raw_text = res.json()["choices"][0]["message"]["content"]
                        return self._parse_json_notes(raw_text, prompt, research_context)
                    else:
                        print(f"[LinkerAgent] OpenRouter API Error {res.status_code}: {res.text}")
                except Exception as e:
                    print(f"[LinkerAgent] OpenRouter API Exception: {e}")

        # Fallback deterministic note generator if no LLM key was provided or calls failed
        return [
            SynthesizedNoteDraft(
                title=prompt.title(),
                suggested_filename=re.sub(r'[^a-z0-9]+', '-', prompt.lower()).strip('-'),
                body_markdown=f"# {prompt.title()}\n\n{research_context[:1500]}\n\n## Summary\nGenerated from research context.",
                tags=["vault-agent", "generated"],
                aliases=[prompt],
                is_moc=False
            )
        ]

    def _parse_json_notes(self, raw_json: str, prompt: str, research_context: str) -> List[SynthesizedNoteDraft]:
        try:
            # Clean up raw_json if it is enclosed in markdown code blocks
            clean_json = raw_json.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.startswith("```"):
                clean_json = clean_json[3:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            clean_json = clean_json.strip()

            parsed = json.loads(clean_json)
            if isinstance(parsed, dict) and "notes" in parsed:
                parsed = parsed["notes"]
            if not isinstance(parsed, list):
                parsed = [parsed]

            notes = []
            for item in parsed:
                notes.append(SynthesizedNoteDraft(
                    title=item.get("title", "Untitled Note"),
                    suggested_filename=item.get("suggested_filename", "untitled-note"),
                    body_markdown=item.get("body_markdown", ""),
                    tags=item.get("tags", []),
                    aliases=item.get("aliases", []),
                    is_moc=item.get("is_moc", False)
                ))
            return notes
        except Exception as e:
            print(f"[LinkerAgent] JSON parse error: {e}")
            # Try to recover by regex parsing the title and body_markdown
            title_match = re.search(r'"title"\s*:\s*"([^"]+)"', raw_json)
            body_match = re.search(r'"body_markdown"\s*:\s*"((?:[^"\\]|\\.)*)"', raw_json)
            if title_match and body_match:
                try:
                    title = title_match.group(1)
                    body = body_match.group(1).encode().decode('unicode-escape')
                    return [
                        SynthesizedNoteDraft(
                            title=title,
                            suggested_filename=re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-'),
                            body_markdown=body,
                            tags=["vault-agent", "generated"],
                            aliases=[title],
                            is_moc=False
                        )
                    ]
                except Exception as recovery_err:
                    print(f"[LinkerAgent] Regex recovery failed: {recovery_err}")

            # Absolute fallback if regex recovery fails
            return [
                SynthesizedNoteDraft(
                    title=prompt.title(),
                    suggested_filename=re.sub(r'[^a-z0-9]+', '-', prompt.lower()).strip('-'),
                    body_markdown=f"# {prompt.title()}\n\n{raw_json}\n\n## Research Context\n{research_context[:1000]}",
                    tags=["vault-agent", "generated", "recovered"],
                    aliases=[prompt],
                    is_moc=False
                )
            ]

    def validate_and_sanitize_links(
        self,
        draft_notes: List[SynthesizedNoteDraft],
        indexer: VaultIndexer
    ) -> SynthesisResult:
        """Validates all [[wiki-links]] against real indexer graph nodes (FR-4.4)."""
        wiki_link_pattern = re.compile(r'\[\[([^\]\|#]+)(?:[\|#][^\]]+)?\]\]')
        
        # Valid targets = existing graph nodes + newly planned notes in this session
        session_note_titles = {n.title.lower() for n in draft_notes}
        session_filenames = {n.suggested_filename.lower() for n in draft_notes}
        
        validated_count = 0
        stripped_links = []

        for draft in draft_notes:
            matches = wiki_link_pattern.findall(draft.body_markdown)
            proposed_links = []

            for raw_target in matches:
                clean_target = raw_target.strip()
                canonical = indexer._resolve_link_target(clean_target)
                
                exists_in_vault = indexer.graph.has_node(canonical)
                exists_in_session = (
                    clean_target.lower() in session_note_titles or 
                    clean_target.lower() in session_filenames
                )

                if exists_in_vault or exists_in_session:
                    validated_count += 1
                    proposed_links.append(ProposedWikiLink(
                        raw_link=f"[[{clean_target}]]",
                        target_canonical=canonical if exists_in_vault else clean_target,
                        is_existing_in_vault=exists_in_vault
                    ))
                else:
                    # Unrecognized link: record stripped fabricated link
                    stripped_links.append(clean_target)

            draft.proposed_links = proposed_links

        return SynthesisResult(
            notes=draft_notes,
            validated_links_count=validated_count,
            stripped_fabricated_links=stripped_links
        )

linker_agent = LinkerSynthesisAgent()
