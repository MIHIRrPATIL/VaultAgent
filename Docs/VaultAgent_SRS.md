# VaultAgent — Software Requirements Specification

---

## 1. System Overview

VaultAgent is a local-first desktop application (Tauri + React + TypeScript frontend, Python/FastAPI backend) that autonomously researches topics or refines raw notes, then generates properly formatted, interlinked Markdown files for an Obsidian vault.

The system is composed of four backend agents operating in sequence, a set of frontend screens that drive and visualize that pipeline, and a persistence layer that maintains a graph representation of the vault.

---

## 2. Vault Indexer Agent

### 2.1 Purpose
Builds and maintains an accurate, queryable model of the user's existing vault — every note, its metadata, and its link relationships to every other note — so downstream agents can reference and connect to existing content.

### 2.2 Functional Requirements

**FR-2.1** The system shall scan the configured vault directory recursively, excluding any folders the user has marked as excluded (default exclusions: `Templates`, `Attachments`, `.trash`, `.obsidian`).

**FR-2.2** For every `.md` file found, the system shall extract:the
- YAML frontmatter (all key-value fields, including tags and aliases)
- All heading text (for structural context)
- All outgoing `[[wiki-link]]` references, correctly distinguishing links in body text from links that appear inside code blocks or blockquotes (which should not be treated as real links)

**FR-2.3** The system shall represent the vault as a directed graph: each note is a node carrying its frontmatter/metadata, each `[[link]]` is a directed edge from the linking note to the linked note.

**FR-2.4** The system shall persist this graph to local disk (not rebuilt from scratch on every launch) so that subsequent app starts load an existing graph rather than re-parsing the entire vault.

**FR-2.5** On subsequent scans, the system shall only re-parse files whose content has changed since the last index (detected via content hash, not just modified-timestamp, since some editors update mtime without changing content), and update only the affected nodes/edges in the graph — not the full vault.

**FR-2.6** The system shall support a manual "Re-index Now" action that forces a full re-scan, for cases where the incremental detection may have missed something (e.g. files changed outside the app while it wasn't running, or moved/renamed).

**FR-2.7** The system shall expose a queryable interface over the graph supporting:
- Direct neighbor lookup (notes directly linked to/from a given note) — powers "shallow" linking mode
- Multi-hop traversal up to a configurable depth — powers "deep contextual" linking mode
- Orphan detection (notes with zero incoming or outgoing links)
- In-degree ranking (most-linked notes, for the Dashboard)

### 2.3 Implementation Approach
- Parse Markdown via an AST-based parser (e.g. `markdown-it-py` or `mistune`) rather than regex, so link extraction respects document structure (code blocks, quotes) instead of pattern-matching raw text.
- Model the graph with `networkx.DiGraph` — sufficient for personal-vault scale (tens of thousands of notes is still small for this library), avoids the operational overhead of a dedicated graph database.
- Serialize the graph to disk as a pickled `networkx` object or a JSON edge/node list in the app's local data directory.
- Store a content hash (e.g. SHA-256 of file bytes) per node alongside the graph, to detect real changes during incremental scans.
- Multi-hop traversal implemented via `networkx.single_source_shortest_path_length(graph, note, cutoff=depth)`.

---

## 3. Web Discovery & Research Agent

### 3.1 Purpose
Given a topic, retrieves relevant, clean source material from the web to serve as the factual basis for a new note.

### 3.2 Functional Requirements

**FR-3.1** Given a topic string, the system shall query a web search provider and retrieve a ranked list of candidate source URLs.

**FR-3.2** The system shall support an optional list of user-supplied URLs that either restrict the search to only those sources, or are prioritized above general search results — this behavior shall be an explicit, user-visible setting (not a hidden default), since it materially changes what content gets used.

**FR-3.3** For each selected source, the system shall scrape and extract clean readable text, discarding navigation elements, ads, and other non-content page structure.

**FR-3.4** The system shall filter or deduplicate near-identical content across multiple sources before passing it downstream, to avoid the same fact being redundantly processed multiple times.

**FR-3.5** The system shall cap the number of concurrent scrape requests (recommended: 3–4 in flight at once) to bound peak memory usage and avoid overwhelming target sites or the scraping provider's rate limits.

**FR-3.6** If a source fails to load or scrape, the system shall continue with the remaining sources rather than failing the entire research run, and shall surface which sources failed in the live progress feed.

**FR-3.7** When the user has selected "Raw Note Conversion" mode instead of "Autonomous Research," this agent shall be skipped entirely, and the user-supplied raw draft text shall be passed directly to the Linker & Synthesis Agent instead.

### 3.3 Implementation Approach
- Search via Tavily or Exa (AI-optimized search APIs return cleaner, more relevant results for this use case than general-purpose search APIs).
- Scrape via Firecrawl, which returns pre-cleaned Markdown/text rather than raw HTML, reducing post-processing work.
- Run scrape calls concurrently using `asyncio.gather` with a `Semaphore(4)` to enforce the concurrency cap from FR-3.5.
- API keys for both providers are supplied per-request via headers from the frontend (never persisted server-side), consistent with the system-wide key handling approach (see Section 11).

---

## 4. Linker & Synthesis Agent

### 4.1 Purpose
The core intelligence of the system: combines newly retrieved research (or a raw draft) with the existing vault's content, producing a coherent write-up that correctly references related existing notes.

### 4.2 Functional Requirements

**FR-4.1** The system shall identify existing notes in the vault that are topically related to the new content, using the vault graph and note metadata (not just keyword string-matching) as context for this determination.

**FR-4.2** The system shall insert `[[wiki-links]]` into the generated content at points where it references a concept covered by an existing note, using the exact filename/alias required for Obsidian to resolve the link correctly.

**FR-4.3** The system shall support two linking modes, user-selectable via the Length & Linking Depth controls:
- **Shallow**: link only to notes with an existing direct relationship (shared tags, direct graph neighbors) to the topic.
- **Deep**: link to notes discovered via multi-hop graph traversal and semantic relevance, surfacing less-obvious but still meaningful connections.

**FR-4.4** The system shall never fabricate a link to a note that does not exist in the vault — every `[[link]]` produced must correspond to a real, indexed note, or must be clearly a *new* note to be created (in which case downstream logic should flag it rather than silently producing a broken link).

**FR-4.5** The system shall adjust output length according to the user's selected target (Short / Medium / Long), and adjust structure/tone according to the selected Style Preset (Atomic/Zettelkasten, Long-Form Essay, Deep Technical Documentation).

**FR-4.6** For Atomic/Zettelkasten style specifically, the system shall be capable of splitting a single topic into multiple smaller interlinked files plus a central Map of Content file that links to each, rather than producing one large note.

### 4.3 Implementation Approach
- This step is a prompted LLM call (Claude/GPT-class model), not a local model — quality of relationship-finding is the most failure-prone part of the whole product and benefits most from a strong model.
- Before generating, construct a context payload containing: the new source material, a relevant subgraph of the vault (candidate related notes and their titles/aliases/summaries — not the entire vault, to stay within context limits), and the user's selected style/length/depth settings.
- Use structured output (JSON mode / forced schema) for the LLM response so that generated links can be programmatically validated against FR-4.4 before being handed to the Writer Agent — i.e., the backend should verify every `[[link]]` in the model's output actually resolves to a node in the vault graph, and strip or flag any that don't.
- **Before building the full pipeline**, validate this agent's output quality manually: take several real notes from the actual target vault, manually supply sample research text, and inspect whether the model's proposed links and synthesis are genuinely useful — this is the single highest-risk part of the system and should be validated cheaply before investing in the surrounding infrastructure.

---

## 5. Writer Agent

### 5.1 Purpose
Takes the synthesized content and produces the final, properly formatted Markdown file(s), ready to be written to the vault.

### 5.2 Functional Requirements

**FR-5.1** The system shall apply YAML frontmatter to every generated file, populated according to the user's configured default schema (e.g. `tags`, `created`, `source`, `aliases`, `status`), with date fields formatted per the user's configured date format preference.

**FR-5.2** The system shall apply Obsidian-style callout formatting (e.g. `> [!NOTE]`) where the content warrants it (asides, warnings, definitions), based on the selected style preset.

**FR-5.3** The system shall name generated files according to the user's configured naming convention (kebab-case, Title Case, or timestamp-prefixed), ensuring the filename matches exactly what any `[[links]]` pointing to it expect.

**FR-5.4** The system shall detect filename collisions against existing vault files before saving, and either append a disambiguating suffix or prompt the user to confirm an overwrite — silent overwriting is not acceptable.

**FR-5.5** The system shall NOT write files directly to the vault as part of generation — output must first be returned to the frontend for user review (see Section 8), and only written to disk upon explicit user confirmation ("Save to Vault").

**FR-5.6** Upon save, the system shall update the vault graph (Section 2) to include the newly added node(s) and edges, without requiring a full re-index.

### 5.3 Implementation Approach
- Frontmatter/formatting can be handled with a smaller, cheaper LLM call than the Synthesis step, or in some cases with deterministic templating (e.g. Jinja2) once the synthesized content and metadata are already structured — evaluate whether an LLM call is even necessary here versus pure templating, since this step is comparatively low-risk and may not need model intelligence at all.
- File writes performed via standard file I/O on the backend once the frontend confirms save; path is sanitized against directory traversal.

---

## 6. Onboarding / Vault Setup

### 6.1 Functional Requirements

**FR-6.1** The system shall allow the user to either select an existing folder as their vault or create a new one, via a native OS folder picker.

**FR-6.2** The system shall validate that a selected existing folder is a genuine Obsidian vault (presence of a `.obsidian` directory), and if it is not, shall ask the user whether to proceed anyway (supporting users who keep plain Markdown folders without the Obsidian app) or initialize a new `.obsidian` structure there.

**FR-6.3** The system shall allow the user to configure, during setup: excluded folders, default save subfolder for generated content, frontmatter schema, date format, filename convention, default style preset, default linking depth, and API keys.

**FR-6.4** All onboarding fields except vault selection shall have sensible pre-filled defaults, and shall be editable later from Settings — onboarding should not be the only opportunity to configure them.

**FR-6.5** API key entry shall be skippable during onboarding without blocking progress to the main app, with a persistent visual indicator that keys are not yet configured until the user provides them.

---

## 7. Home / Prompt Input

### 7.1 Functional Requirements

**FR-7.1** The system shall provide a single primary text input for the user's topic or instruction.

**FR-7.2** The system shall provide a toggle for Web Search (Autonomous Research) vs. Raw Note Conversion mode, which determines both the placeholder guidance shown and which optional secondary input is available.

**FR-7.3** When Web Search is enabled, the system shall provide an optional, collapsed-by-default panel allowing the user to add specific URLs to prioritize or restrict the research to (per FR-3.2). This panel shall not be visible by default, to avoid visually crowding the primary input for the common case where it is unused.

**FR-7.4** When Web Search is disabled, the system shall provide an optional, collapsed-by-default panel allowing the user to paste raw draft text to be refined instead of researched.

**FR-7.5** The system shall provide visible, editable controls for Style Preset, target Length, and (implicitly, via the Web Search toggle) input mode, before the user submits a request.

**FR-7.6** Any optional secondary input panel shall internally scroll rather than grow unbounded if its content is large (e.g. many URLs, a long pasted draft), so the primary layout does not become dominated by edge-case input sizes.

---

## 8. Live Agent Process View

### 8.1 Functional Requirements

**FR-8.1** Once a request is submitted, the system shall display the real-time status of each of the four pipeline stages (Indexer, Discovery, Linker, Writer), each shown as pending, active, complete, or error.

**FR-8.2** The system shall stream human-readable status messages as they occur (e.g. "Scraping 6 sources...", "Found 3 related notes in vault") rather than only showing a generic loading state.

**FR-8.3** If a stage encounters a non-fatal issue (e.g. one source failed to scrape, per FR-3.6), the system shall surface this without halting the overall pipeline, distinguishing recoverable warnings from a full pipeline failure.

**FR-8.4** If the pipeline fails entirely, the system shall present a clear error state explaining which stage failed and why, rather than leaving the user on an indefinitely "active" spinner.

### 8.2 Implementation Approach
- Backend exposes progress via Server-Sent Events (one-directional, matches the actual data flow needs — no bidirectional communication is required for this feature).
- The pipeline-triggering endpoint should return immediately with a session identifier and run the actual agent work as a background task, with the SSE stream reporting real progress from that background task — a blocking request/response model cannot support this feature, since there would be nothing to stream.
- Frontend must explicitly close the `EventSource` connection when the view unmounts, to avoid leaving idle open connections if the user navigates away mid-run.

---

## 9. Generated File Review

### 9.1 Functional Requirements

**FR-9.1** Upon pipeline completion, the system shall present all generated files in a list, allowing the user to select and preview each one individually.

**FR-9.2** The preview shall render Markdown formatting (headings, lists, code blocks) and shall visually distinguish `[[wiki-links]]` from plain text.

**FR-9.3** The user shall be able to Discard the entire result (no files written), Regenerate (re-run the pipeline, optionally with the same or adjusted inputs), or Save to Vault (commit files per FR-5.5–5.6).

**FR-9.4** The system shall NOT consider a generation complete or log it to History (Section 10) until the user has explicitly chosen Save or Discard — an abandoned/unreviewed result should not silently persist.

---

## 10. Dashboard

### 10.1 Functional Requirements

**FR-10.1** The system shall display summary statistics: total notes in vault, notes generated in the current week, and total links created by the system.

**FR-10.2** The system shall display a navigable directory tree of the vault, visually matching the user's actual folder structure, with a distinguishing indicator on files that were created by VaultAgent versus pre-existing files.

**FR-10.3** The system shall display a chronological feed of recent activity (research runs, raw note conversions, manual re-indexes).

**FR-10.4** The system shall display the most-linked notes in the vault, ranked by graph in-degree (per FR-2.7).

**FR-10.5** The directory tree shall support search/filter by filename.

### 10.2 Implementation Approach
- Directory tree endpoint reads directly from the persisted vault graph (Section 2) rather than re-walking the filesystem on every Dashboard load, since the graph is already the source of truth and is kept incrementally up to date.

---

## 11. Chats / History

### 11.1 Functional Requirements

**FR-11.1** The system shall maintain a persistent, chronological log of past generation sessions, each recording: the original prompt/input, selected style, number of files produced, and timestamp.

**FR-11.2** Selecting a past session shall reopen the Generated File Review view (Section 9) populated with that session's actual saved output, not a re-run.

**FR-11.3** The history list shall support search/filter by prompt text.

**FR-11.4** An empty history state shall be handled explicitly with guidance directing the user back to Home, not a blank list.

### 11.2 Implementation Approach
- Persist sessions in local SQLite rather than in-memory structures — this is the one piece of the backend that genuinely needs durable structured storage across restarts, and SQLite keeps the system local-first with no external server dependency.

---

## 12. Settings

### 12.1 Functional Requirements

**FR-12.1** The system shall allow editing of every configuration item set during onboarding (Section 6) at any time after setup.

**FR-12.2** The system shall allow entry of API keys for the LLM provider, search provider, and scraping provider, each maskable/revealable, with an individual "Test Connection" action per key that confirms validity without requiring a full pipeline run.

**FR-12.3** API keys shall be stored client-side only, in the frontend's secure local storage — the backend shall never persist API keys to disk; keys are transmitted only as part of individual requests that require them.

**FR-12.4** Changes to individual settings fields shall be saved immediately upon edit, with visible confirmation, rather than requiring a separate global "Save" action.

**FR-12.5** The system shall provide a manual "Re-index Vault" action accessible from Settings (in addition to Dashboard, per FR-10 context), for cases where the user wants to force a full re-scan.

---

## 13. Backend API Layer

### 13.1 Functional Requirements

**FR-13.1** The backend shall expose all functionality described above via a local HTTP API (default `localhost:8000`), callable from the Tauri frontend.

**FR-13.2** The backend shall accept and require appropriate API keys via request headers on any endpoint that performs a paid external API call (search, scrape, or LLM), and shall return a clear, distinguishable error when a required key is missing or invalid — not a generic failure.

**FR-13.3** The backend shall be runnable in two configurations without code changes: as a standalone local process during development, and as a bundled sidecar binary spawned by the Tauri application in production — meaning it must not depend on anything only present in a development environment (e.g. hot-reload-only behavior, dev-only file paths).

**FR-13.4** All backend endpoints shall return structured, typed responses (validated request/response schemas) so the frontend can rely on a stable contract rather than loosely-typed JSON.

### 13.2 Implementation Approach
- FastAPI with Pydantic models for all request/response schemas.
- CORS configured permissively for local development, tightened before distribution (restrict to the actual Tauri origin rather than a wildcard).
- Packaging for production via PyInstaller into a platform-specific binary, declared as a Tauri external binary (sidecar) and spawned via `tauri-plugin-shell` on app launch, communicating over the same local HTTP interface used in development — this ensures frontend code does not need to change based on which mode the backend is running in.

---

## 14. Non-Functional Requirements

**NFR-14.1 (Performance — indexing)**: Vault indexing after the initial full scan shall only process changed files (per FR-2.5), such that a re-index on app launch with no vault changes completes in well under one second regardless of total vault size.

**NFR-14.2 (Performance — concurrency)**: Web scraping shall be bounded to a small fixed concurrency (FR-3.5) to keep peak memory usage predictable regardless of how many sources a research run touches.

**NFR-14.3 (Resilience)**: Partial failures in any single pipeline stage (one bad source, one failed API call) shall not silently corrupt or block the overall run; failures shall be reported specifically, and where possible the pipeline shall continue with the remaining valid inputs.

**NFR-14.4 (Data integrity)**: The system shall never write a file to the user's actual vault without explicit user confirmation (FR-5.5, FR-9.4) — this is treated as a hard constraint given the user's vault is a trusted personal knowledge base.

**NFR-14.5 (Security)**: No API key shall be written to persistent backend storage or logs at any point (FR-12.3); keys exist only in frontend-managed secure storage and in-memory during an active request.

**NFR-14.6 (Portability)**: Backend logic shall not assume the presence of a Python environment on the end user's machine in production — all Python dependencies must be resolvable at build time and bundled into the sidecar binary (FR-13.3).
