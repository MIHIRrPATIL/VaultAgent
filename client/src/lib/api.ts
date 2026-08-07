import { invoke } from "@tauri-apps/api/core";

let activeApiUrl = "";

export async function getApiBaseUrl(): Promise<string> {
  if (activeApiUrl) return activeApiUrl;

  try {
    const port = await invoke<number>("get_backend_port");
    if (port) {
      activeApiUrl = `http://127.0.0.1:${port}`;
      return activeApiUrl;
    }
  } catch (e) {}

  try {
    const res5000 = await fetch("http://127.0.0.1:5000/health");
    if (res5000.ok) {
      activeApiUrl = "http://127.0.0.1:5000";
      return activeApiUrl;
    }
  } catch (e) {}

  try {
    const res8000 = await fetch("http://127.0.0.1:8000/health");
    if (res8000.ok) {
      activeApiUrl = "http://127.0.0.1:8000";
      return activeApiUrl;
    }
  } catch (e) {}

  return "http://127.0.0.1:5000";
}

export interface VaultConfig {
  vaultPath: string;
  vaultId?: string;
  excludedFolders?: string[];
  saveLocationType?: "root" | "custom";
  customSavePath?: string;
  namingConvention?: "kebab" | "title" | "timestamp";
  dateFormat?: "YYYY-MM-DD" | "ISO";
  frontmatterKeys?: string[];
  stylePreset?: "atomic" | "long" | "deep";
  linkingDepth?: "shallow" | "deep";
  autoIndexOnLaunch?: boolean;
  geminiKey?: string;
  openrouterKey?: string;
  tavilyKey?: string;
  firecrawlKey?: string;
  searchProvider?: "duckduckgo" | "tavily";
  scrapeProvider?: "crawl4ai" | "firecrawl" | "httpx";
}

export interface ScanResponse {
  status: string;
  nodes: number;
  real_files?: number;
  edges: number;
  aliases_indexed: number;
  config: Record<string, any>;
}

export interface NeighborsResponse {
  canonical_path: string;
  incoming: string[];
  outgoing: string[];
  frontmatter: Record<string, any>;
  headings: Array<{ level: number; text: string }>;
  tags: string[];
  is_generated: boolean;
}

export interface DeepLinksResponse {
  canonical_path: string;
  depth_cutoff: number;
  connected_nodes: Record<string, number>;
}

export interface OrphansResponse {
  orphans: string[];
}

export interface TopNodesResponse {
  top_nodes: Array<{ node: string; in_degree: number }>;
}

export interface NodeItem {
  path: string;
  tags: string[];
  headings: Array<{ level: number; text: string }>;
  is_generated: boolean;
  is_existing_file?: boolean;
  in_degree: number;
  out_degree: number;
}

export interface StagedFile {
  id: string;
  filename: string;
  rel_path: string;
  full_target_path: string;
  frontmatter: Record<string, any>;
  content: string;
  has_collision: boolean;
  collision_action: "disambiguate" | "overwrite";
}

export interface PipelineProgressEvent {
  session_id: string;
  timestamp: string;
  stage: "indexer" | "discovery" | "linker" | "writer" | "completed" | "error";
  event_type: "stage_start" | "stage_progress" | "stage_warning" | "stage_complete" | "pipeline_complete" | "error";
  message: string;
  progress_percent: number;
  data?: {
    staged_files?: StagedFile[];
    [key: string]: any;
  };
}

export interface PipelineRunPayload {
  vault_path: string;
  vault_id?: string;
  prompt: string;
  mode: "research" | "raw_convert";
  urls?: string[];
  raw_drafts?: string[];
  style_preset: "atomic" | "essay" | "technical";
  length: "short" | "medium" | "long";
  linking_depth: "shallow" | "deep";
  custom_save_path?: string;
  naming_convention?: string;
  date_format?: string;
  frontmatter_keys?: string[];
  search_provider?: "duckduckgo" | "tavily";
  scrape_provider?: "crawl4ai" | "firecrawl" | "httpx";
}

export interface ApiKeyHeaders {
  geminiKey?: string;
  openrouterKey?: string;
  tavilyKey?: string;
  firecrawlKey?: string;
}

export interface SessionHistoryItem {
  session_id: string;
  created_at: string;
  prompt: string;
  mode: string;
  style_preset: string;
  length: string;
  linking_depth: string;
  status: string;
  output_files_count: number;
}

export async function scanVault(config: VaultConfig, force: boolean = false): Promise<ScanResponse> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vault_path: config.vaultPath,
      force,
      excludes: config.excludedFolders,
      config: {
        custom_save_path: config.customSavePath,
        style_preset: config.stylePreset,
        linking_depth: config.linkingDepth,
      },
    }),
  });
  if (!res.ok) throw new Error("Failed to trigger vault scan");
  return res.json();
}

export async function fetchNeighbors(nodePath: string): Promise<NeighborsResponse> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/graph/neighbors?path=${encodeURIComponent(nodePath)}`);
  if (!res.ok) throw new Error("Failed to fetch node neighbors");
  return res.json();
}

export async function fetchDeepLinks(nodePath: string, depth?: number): Promise<DeepLinksResponse> {
  const baseUrl = await getApiBaseUrl();
  const url = depth
    ? `${baseUrl}/indexer/graph/deeplinks?path=${encodeURIComponent(nodePath)}&depth=${depth}`
    : `${baseUrl}/indexer/graph/deeplinks?path=${encodeURIComponent(nodePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch deep links");
  return res.json();
}

export async function fetchOrphans(): Promise<OrphansResponse> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/graph/orphans`);
  if (!res.ok) throw new Error("Failed to fetch orphans");
  return res.json();
}

export async function fetchTopNodes(limit: number = 10): Promise<TopNodesResponse> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/graph/top?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch top nodes");
  return res.json();
}

export async function fetchAllNodes(): Promise<{ nodes: NodeItem[] }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/graph/nodes`);
  if (!res.ok) throw new Error("Failed to fetch nodes");
  return res.json();
}

export async function readNodeContent(nodePath: string): Promise<{ canonical_path?: string; content?: string; error?: string }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/indexer/read?path=${encodeURIComponent(nodePath)}`);
  if (!res.ok) throw new Error("Failed to read node content");
  return res.json();
}

export async function startPipelineRun(payload: PipelineRunPayload, keys?: ApiKeyHeaders): Promise<{ session_id: string; status: string }> {
  const baseUrl = await getApiBaseUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (keys?.geminiKey) headers["X-Gemini-Key"] = keys.geminiKey;
  if (keys?.openrouterKey) headers["X-OpenRouter-Key"] = keys.openrouterKey;
  if (keys?.tavilyKey) headers["X-Tavily-Key"] = keys.tavilyKey;
  if (keys?.firecrawlKey) headers["X-Firecrawl-Key"] = keys.firecrawlKey;

  const res = await fetch(`${baseUrl}/pipeline/start`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to start pipeline execution");
  return res.json();
}

export async function fetchPipelineSession(sessionId: string): Promise<any> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/pipeline/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch pipeline session");
  return res.json();
}

export async function commitPipelineSession(sessionId: string, selectedFileIds?: string[]): Promise<any> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/pipeline/session/${sessionId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_file_ids: selectedFileIds || null }),
  });
  if (!res.ok) throw new Error("Failed to commit pipeline session");
  return res.json();
}

export async function discardPipelineSession(sessionId: string): Promise<any> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/pipeline/session/${sessionId}/discard`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to discard pipeline session");
  return res.json();
}

export async function updateStagedFile(
  sessionId: string,
  fileId: string,
  content: string,
  filename?: string,
  frontmatter?: Record<string, any>
): Promise<any> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/pipeline/session/${sessionId}/file/${fileId}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, filename, frontmatter }),
  });
  if (!res.ok) throw new Error("Failed to update staged file content");
  return res.json();
}

export async function refineStagedFile(
  sessionId: string,
  fileId: string,
  instruction: string,
  urls?: string[],
  geminiKey?: string,
  openrouterKey?: string
): Promise<StagedFile> {
  const baseUrl = await getApiBaseUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (geminiKey) headers["x-gemini-key"] = geminiKey;
  if (openrouterKey) headers["x-openrouter-key"] = openrouterKey;

  const res = await fetch(`${baseUrl}/pipeline/session/${sessionId}/file/${fileId}/refine`, {
    method: "POST",
    headers,
    body: JSON.stringify({ instruction, urls: urls || null }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "Failed to refine staged file with AI");
  }
  return res.json();
}

export async function fetchHistorySessions(limit: number = 50, offset: number = 0): Promise<{ sessions: SessionHistoryItem[] }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/history/sessions?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error("Failed to fetch history sessions");
  return res.json();
}

export async function fetchHistorySessionDetail(sessionId: string): Promise<any> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/history/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch history session detail");
  return res.json();
}

export async function testApiKey(provider: "gemini" | "openrouter" | "tavily" | "firecrawl", apiKey: string): Promise<{ valid: boolean; message: string }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/settings/test-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!res.ok) return { valid: false, message: "Failed to connect to backend service" };
  return res.json();
}

export function getStoredVaultConfig(): VaultConfig | null {
  const raw = localStorage.getItem("vault_agent_config");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function saveVaultConfig(config: VaultConfig): void {
  localStorage.setItem("vault_agent_config", JSON.stringify(config));
}

export interface MemoryItem {
  id: string;
  scope: "global" | "vault";
  vault_id?: string;
  content: string;
  memory_type?: string;
  tags?: string[];
  confidence?: number;
  status: "pending" | "confirmed" | "dismissed";
  created_at: string;
}

export async function fetchMemories(scope: "global" | "vault", vaultId?: string): Promise<{ memories: MemoryItem[] }> {
  const baseUrl = await getApiBaseUrl();
  const url = vaultId
    ? `${baseUrl}/memory?scope=${scope}&vault_id=${encodeURIComponent(vaultId)}`
    : `${baseUrl}/memory?scope=${scope}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch memories");
  return res.json();
}

export async function deleteMemory(id: string): Promise<{ status: string }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/memory/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete memory");
  return res.json();
}

export async function confirmMemory(id: string): Promise<{ status: string }> {
  const baseUrl = await getApiBaseUrl();
  const res = await fetch(`${baseUrl}/memory/${id}/confirm`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to confirm memory");
  return res.json();
}
