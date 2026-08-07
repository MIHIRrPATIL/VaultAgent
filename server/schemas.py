from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Literal

class PipelineRunRequest(BaseModel):
    vault_path: str = Field(..., description="Absolute path to target Obsidian vault")
    vault_id: Optional[str] = Field(None, description="Stable vault UUID for memory scoping")
    prompt: str = Field(..., description="User prompt, research topic, or conversion instructions")
    mode: Literal["research", "raw_convert"] = Field("research", description="Autonomous Research vs Raw Draft Conversion")
    urls: Optional[List[str]] = Field(default=[], description="User-supplied URL restrictions or priority sources")
    raw_drafts: Optional[List[str]] = Field(default=[], description="Pasted raw notes/drafts")
    
    # Options
    style_preset: Literal["atomic", "essay", "technical"] = Field("atomic", description="Atomic/Zettelkasten, Essay, or Technical Doc")
    length: Literal["short", "medium", "long"] = Field("medium", description="Target output length")
    linking_depth: Literal["shallow", "deep"] = Field("deep", description="Shallow (1-hop) vs Deep (multi-hop graph traversal)")
    
    # Configuration overrides
    custom_save_path: Optional[str] = Field("/Generated", description="Subfolder inside vault to save generated notes")
    naming_convention: Optional[str] = Field("kebab", description="kebab | title | timestamp")
    date_format: Optional[str] = Field("YYYY-MM-DD", description="Date format in frontmatter")
    frontmatter_keys: Optional[List[str]] = Field(default=["tags", "created", "source", "status"])
    
    # Search and Scrape Providers
    search_provider: Literal["duckduckgo", "tavily"] = Field("duckduckgo", description="Web search provider")
    scrape_provider: Literal["crawl4ai", "firecrawl", "httpx"] = Field("crawl4ai", description="Web scraping engine")

class CandidateNoteSummary(BaseModel):
    canonical_path: str
    filename: str
    frontmatter: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    headings: List[Dict[str, Any]] = Field(default_factory=list)
    excerpt: str = ""
    in_degree: int = 0
    out_degree: int = 0

class VaultSubgraphPayload(BaseModel):
    vault_path: str
    target_depth: int
    candidate_notes: List[CandidateNoteSummary] = Field(default_factory=list)
    all_indexed_aliases: List[str] = Field(default_factory=list)

class SearchCandidate(BaseModel):
    url: str
    title: str
    snippet: str
    score: Optional[float] = None

class ScrapedSource(BaseModel):
    url: str
    title: str
    markdown_content: str
    success: bool = True
    error_message: Optional[str] = None

class ResearchOutput(BaseModel):
    topic: str
    sources_attempted: int = 0
    sources_succeeded: int = 0
    sources: List[ScrapedSource] = Field(default_factory=list)
    combined_deduped_context: str = ""

class ProposedWikiLink(BaseModel):
    raw_link: str
    target_canonical: str
    is_existing_in_vault: bool = False

class SynthesizedNoteDraft(BaseModel):
    title: str
    suggested_filename: str
    body_markdown: str
    proposed_links: List[ProposedWikiLink] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    aliases: List[str] = Field(default_factory=list)
    is_moc: bool = False

class SynthesisResult(BaseModel):
    notes: List[SynthesizedNoteDraft] = Field(default_factory=list)
    validated_links_count: int = 0
    stripped_fabricated_links: List[str] = Field(default_factory=list)

class StagedFile(BaseModel):
    id: str
    filename: str
    rel_path: str
    full_target_path: str
    frontmatter: Dict[str, Any] = Field(default_factory=dict)
    content: str
    has_collision: bool = False
    collision_action: Literal["disambiguate", "overwrite"] = "disambiguate"

class PipelineProgressEvent(BaseModel):
    session_id: str
    timestamp: str
    stage: Literal["indexer", "discovery", "linker", "writer", "completed", "error"]
    event_type: Literal["stage_start", "stage_progress", "stage_warning", "stage_complete", "pipeline_complete", "error"]
    message: str
    progress_percent: int = 0
    data: Optional[Dict[str, Any]] = None

class SessionCommitRequest(BaseModel):
    selected_file_ids: Optional[List[str]] = Field(default=None, description="List of file IDs to commit (None = commit all)")

class KeyTestRequest(BaseModel):
    provider: Literal["gemini", "openrouter", "tavily", "firecrawl"]
    api_key: str
