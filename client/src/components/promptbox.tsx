import { useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Send, X, FileText, Plus } from "lucide-react";
import { getRandomPlaceholder } from "../lib/placeholers";
import { getStoredVaultConfig, saveVaultConfig, startPipelineRun } from "../lib/api";
import { getSecret } from "../lib/secrets";

interface PromptboxProps {
  setActiveSessionId: (id: string | null) => void;
}

function Promptbox({ setActiveSessionId }: PromptboxProps) {
  const [prompt, setPrompt] = useState("");
  const [placeholder] = useState(getRandomPlaceholder());

  // Pipeline session state
  const [isStarting, setIsStarting] = useState(false);

  // Interactive options states
  const [style, setStyle] = useState("ATOMIC");
  const [length, setLength] = useState("SHORT");
  const [webSearch, setWebSearch] = useState(true);

  // Opt-in: panel only renders once the user asks for it
  const [panelOpen, setPanelOpen] = useState(false);

  // Web search ON: optional URL scoping
  const [urlInput, setUrlInput] = useState("");
  const [urls, setUrls] = useState<string[]>([]);

  // Web search OFF: optional raw drafts (multi-item list)
  const [draftInput, setDraftInput] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);

  const cycleStyle = () => {
    const styles = ["ATOMIC", "CREATIVE", "PRECISE"];
    const nextIdx = (styles.indexOf(style) + 1) % styles.length;
    setStyle(styles[nextIdx]);
  };

  const cycleLength = () => {
    const lengths = ["SHORT", "MEDIUM", "LONG"];
    const nextIdx = (lengths.indexOf(length) + 1) % lengths.length;
    setLength(lengths[nextIdx]);
  };

  // Reset panel when toggling web search mode
  const toggleWebSearch = () => {
    setWebSearch((v) => !v);
    setPanelOpen(false);
  };

  const addUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setUrls((prev) => [...prev, trimmed]);
    setUrlInput("");
  };

  const handleUrlKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addUrl();
    }
  };

  const removeUrl = (i: number) => {
    setUrls((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addDraft = () => {
    const trimmed = draftInput.trim();
    if (!trimmed) return;
    setDrafts((prev) => [...prev, trimmed]);
    setDraftInput("");
  };

  const handleDraftKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addDraft();
    }
  };

  const removeDraft = (i: number) => {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSend = async () => {
    if (!prompt.trim() || isStarting) return;
    const config = getStoredVaultConfig();
    const vaultPath = config?.vaultPath || "/home/mihir/Documents/Obsidian/DSA/DSA";
    let vaultId = config?.vaultId || "";
    if (config && !vaultId) {
      vaultId = crypto.randomUUID();
      config.vaultId = vaultId;
      saveVaultConfig(config);
    }

    setIsStarting(true);
    try {
      const payload = {
        vault_path: vaultPath,
        vault_id: vaultId,
        prompt: prompt.trim(),
        mode: webSearch ? ("research" as const) : ("raw_convert" as const),
        urls: urls,
        raw_drafts: drafts,
        style_preset: (style.toLowerCase() === "creative" ? "essay" : style.toLowerCase() === "precise" ? "technical" : "atomic") as "atomic" | "essay" | "technical",
        length: length.toLowerCase() as "short" | "medium" | "long",
        linking_depth: (config?.linkingDepth || "deep") as "shallow" | "deep",
        custom_save_path: config?.customSavePath || "/Generated",
        naming_convention: config?.namingConvention || "kebab",
        date_format: config?.dateFormat || "YYYY-MM-DD",
        frontmatter_keys: config?.frontmatterKeys || ["tags", "created", "source", "status"],
        search_provider: config?.searchProvider || "duckduckgo",
        scrape_provider: config?.scrapeProvider || "crawl4ai",
      };

      const keys = {
        geminiKey: await getSecret("geminiKey"),
        openrouterKey: await getSecret("openrouterKey"),
        tavilyKey: await getSecret("tavilyKey"),
        firecrawlKey: await getSecret("firecrawlKey"),
      };

      const res = await startPipelineRun(payload, keys);
      setActiveSessionId(res.session_id);
      setPrompt("");
      setUrls([]);
      setDrafts([]);
      setUrlInput("");
      setDraftInput("");
    } catch (err) {
      console.error("Error starting pipeline:", err);
      alert("Failed to start agent pipeline. Ensure backend service is running.");
    } finally {
      setIsStarting(false);
    }
  };


  const hasContent = webSearch ? urls.length > 0 : drafts.length > 0;

  // Extract domain from URL for preview display
  const getDomain = (url: string) => {
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      return u.hostname.replace("www.", "");
    } catch {
      return url.length > 24 ? url.slice(0, 24) + "…" : url;
    }
  };

  // Get a short path hint from the URL
  const getPath = (url: string) => {
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      const p = u.pathname;
      if (p === "/" || p === "") return "";
      return p.length > 20 ? p.slice(0, 20) + "…" : p;
    } catch {
      return "";
    }
  };

  return (
    <div className="w-[65%] max-w-4xl flex flex-col gap-6 items-center">
      {/* Glassmorphism prompt box card */}
      <div id="prompt-input-card" className="bg-black/30 backdrop-blur-2xl w-full flex flex-col border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Preview strip — shows above textarea when URLs or drafts are attached */}
        <AnimatePresence>
          {hasContent && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.45, 0, 0.55, 1] }}
              className="overflow-hidden"
            >
              <div className="px-6 pt-4 pb-1 flex flex-wrap gap-2 items-center">
                {webSearch ? (
                  /* URL preview chips with favicon + domain */
                  urls.map((url, i) => (
                    <motion.div
                      key={`preview-${url}-${i}`}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      transition={{ duration: 0.15, delay: i * 0.04 }}
                      className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-lg px-2.5 py-1.5 group"
                    >
                      <img
                        src={`https://www.google.com/s2/favicons?sz=32&domain=${getDomain(url)}`}
                        alt=""
                        className="w-4 h-4 rounded-sm opacity-70"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm text-secondry/60">{getDomain(url)}</span>
                        {getPath(url) && (
                          <span className="text-xs text-secondry/25">{getPath(url)}</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeUrl(i)}
                        className="ml-0.5 text-secondry/20 hover:text-secondry/60 transition-colors cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))
                ) : (
                  /* Draft preview chips */
                  drafts.map((draft, i) => (
                    <motion.div
                      key={`draft-preview-${i}`}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      transition={{ duration: 0.15, delay: i * 0.04 }}
                      className="flex items-center gap-2 bg-accent/8 border border-accent/20 rounded-lg px-3 py-1.5"
                    >
                      <FileText size={13} className="text-accent/60 shrink-0" />
                      <span className="text-sm text-secondry/40 truncate max-w-55">
                        {draft.slice(0, 60)}{draft.length > 60 ? "…" : ""}
                      </span>
                      <button
                        onClick={() => removeDraft(i)}
                        className="ml-0.5 text-secondry/20 hover:text-secondry/60 transition-colors cursor-pointer shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input/Textarea */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          className="bg-transparent text-secondry/80 placeholder:text-secondry/30 px-6 pt-5 pb-1 text-xl w-full min-h-25 outline-none resize-none"

          placeholder={placeholder}
        />

        {/* Opt-in trigger — compact single line, opens panel on click */}
        <div className="px-6 pb-2">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-secondry/35 hover:text-secondry/60 transition-colors cursor-pointer"
          >
            <Plus
              size={12}
              className={`transition-transform duration-300 ${panelOpen ? "rotate-45" : ""}`}
            />
            {webSearch ? "Add reference URLs" : "Add raw notes"}
            {hasContent && !panelOpen && (
              <span className="ml-1 text-primary">
                ({webSearch ? urls.length : drafts.length})
              </span>
            )}
          </button>
        </div>

        {/* Animated extended panel — collapsed unless explicitly opened */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div
              key={webSearch ? "web-search-panel" : "raw-draft-panel"}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.45, 0, 0.55, 1] }}
              className="px-6 overflow-hidden"
            >
              {webSearch ? (
                <div className="pb-3">
                  <div className="flex gap-2">
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={handleUrlKeyDown}
                      placeholder="https://example.com/article"
                      autoFocus
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base text-secondry/80 placeholder:text-secondry/20 outline-none focus:border-primary/60 transition-colors"
                    />
                    <button
                      onClick={addUrl}
                      className="shine-hover px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-secondry/60 hover:border-primary/60 hover:text-primary hover:bg-white/10 transition-all active:scale-95 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pb-3">
                  <div className="flex gap-2">
                    <textarea
                      value={draftInput}
                      onChange={(e) => setDraftInput(e.target.value)}
                      onKeyDown={handleDraftKeyDown}
                      placeholder="Paste notes, a rough draft, or bullet points... (Enter to add)"
                      rows={2}
                      autoFocus
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-base text-secondry/80 placeholder:text-secondry/20 outline-none focus:border-accent/60 transition-colors resize-none"
                    />
                    <button
                      onClick={addDraft}
                      className="shine-hover px-4 py-2 self-end rounded-lg border border-white/10 bg-white/5 text-sm text-secondry/60 hover:border-accent/60 hover:text-accent hover:bg-white/10 transition-all active:scale-95 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer controls row */}
        <div className="flex justify-between items-center px-6 pb-5 pt-2 select-none">
          {/* Interactive options pills */}
          <div className="flex gap-3">
            <button
              onClick={cycleStyle}
              className="shine-hover text-[15px] tracking-wider px-5 py-2.5 rounded-full border border-white/10 bg-white/5 text-secondry/60 hover:text-secondry hover:border-white/30 hover:bg-white/10 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              STYLE: <span className="text-tertiary">{style}</span>
            </button>
            <button
              onClick={cycleLength}
              className="shine-hover text-[15px] tracking-wider px-5 py-2.5 rounded-full border border-white/10 bg-white/5 text-secondry/60 hover:text-secondry hover:border-white/30 hover:bg-white/10 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              LENGTH: <span className="text-tertiary">{length}</span>
            </button>
            <button
              onClick={toggleWebSearch}
              className="shine-hover text-[15px] tracking-wider px-5 py-2.5 rounded-full border border-white/10 bg-white/5 text-secondry/60 hover:text-secondry hover:border-white/30 hover:bg-white/10 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              WEB SEARCH:{" "}
              <span
                className={
                  webSearch
                    ? "text-pink-400 font-semibold"
                    : "text-secondry/40"
                }
              >
                {webSearch ? "ON" : "OFF"}
              </span>
            </button>
          </div>
          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!prompt.trim()}
            className={`group w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ease-out cursor-pointer ${
              prompt.trim()
                ? "bg-accent text-white shadow-lg shadow-accent/30 scale-100 hover:scale-110 active:scale-90 hover:shadow-accent/45"
                : "bg-white/5 text-white/20 border border-white/5 cursor-not-allowed scale-95 opacity-50"
            }`}
          >
            <Send
              size={20}
              className={`transition-all duration-500 ease-out ${
                prompt.trim()
                  ? "group-hover:rotate-360 group-active:rotate-720 group-active:scale-75"
                  : ""
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

export default Promptbox;
