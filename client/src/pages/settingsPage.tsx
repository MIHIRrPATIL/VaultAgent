import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  SlidersHorizontal,
  Key,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Sliders,
  Check,
  Brain,
  Trash2,
  CheckCircle,
  Sparkles,
} from "lucide-react";
import {
  getStoredVaultConfig,
  saveVaultConfig,
  testApiKey,
  scanVault,
  VaultConfig,
  fetchMemories,
  deleteMemory,
  confirmMemory,
  MemoryItem,
} from "../lib/api";
import { saveSecret, getSecret } from "../lib/secrets";

export const SettingsPage: React.FC = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<VaultConfig>({
    vaultPath: "",
    excludedFolders: [],
    customSavePath: "/Generated",
    namingConvention: "kebab",
    dateFormat: "YYYY-MM-DD",
    frontmatterKeys: [],
    stylePreset: "atomic",
    linkingDepth: "deep",
    geminiKey: "",
    openrouterKey: "",
    tavilyKey: "",
    firecrawlKey: "",
    searchProvider: "duckduckgo",
    scrapeProvider: "crawl4ai",
  });

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [keyStatus, setKeyStatus] = useState<Record<string, { valid: boolean; message: string } | null>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [isReindexing, setIsReindexing] = useState<boolean>(false);
  const [savedBanner, setSavedBanner] = useState<boolean>(false);

  // Memory Layer States
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activeMemoryScope, setActiveMemoryScope] = useState<"vault" | "global">("vault");
  const [isLoadingMemories, setIsLoadingMemories] = useState<boolean>(false);

  const loadMemories = async (scope: "vault" | "global", vaultId?: string) => {
    setIsLoadingMemories(true);
    try {
      const res = await fetchMemories(scope, scope === "vault" ? vaultId : undefined);
      setMemories(res.memories);
    } catch (err) {
      console.error("Failed to load memories:", err);
    } finally {
      setIsLoadingMemories(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    if (!confirm("Are you sure you want to delete this memory?")) return;
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      alert("Failed to delete memory.");
    }
  };

  const handleConfirmMemory = async (id: string) => {
    try {
      await confirmMemory(id);
      setMemories((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status: "confirmed" } : m))
      );
    } catch (err) {
      alert("Failed to confirm memory.");
    }
  };

  // Load existing config on mount
  useEffect(() => {
    const stored = getStoredVaultConfig();
    const initialConfig = stored ? { ...stored } : { ...config };
    
    const loadSecrets = async () => {
      try {
        const geminiKey = await getSecret("geminiKey");
        const openrouterKey = await getSecret("openrouterKey");
        const tavilyKey = await getSecret("tavilyKey");
        const firecrawlKey = await getSecret("firecrawlKey");
        
        setConfig({
          ...initialConfig,
          geminiKey,
          openrouterKey,
          tavilyKey,
          firecrawlKey,
        });
      } catch (err) {
        console.error("Failed to load secure keys:", err);
        setConfig(initialConfig);
      }
    };
    loadSecrets();
  }, []);

  useEffect(() => {
    if (config.vaultId) {
      loadMemories(activeMemoryScope, config.vaultId);
    }
  }, [activeMemoryScope, config.vaultId]);

  const handleSave = async (updatedConfig: VaultConfig) => {
    // Save keys securely in stronghold
    try {
      await saveSecret("geminiKey", updatedConfig.geminiKey || "");
      await saveSecret("openrouterKey", updatedConfig.openrouterKey || "");
      await saveSecret("tavilyKey", updatedConfig.tavilyKey || "");
      await saveSecret("firecrawlKey", updatedConfig.firecrawlKey || "");
    } catch (err) {
      console.error("Failed to save secure keys:", err);
    }

    // Save config without keys in local storage
    const configToStore = {
      ...updatedConfig,
      geminiKey: "",
      openrouterKey: "",
      tavilyKey: "",
      firecrawlKey: "",
    };
    saveVaultConfig(configToStore);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  const updateField = (key: keyof VaultConfig, value: any) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    handleSave(next);
  };

  const handleTestKey = async (provider: "gemini" | "openrouter" | "tavily" | "firecrawl", keyVal: string) => {
    setTestingKey(provider);
    try {
      const res = await testApiKey(provider, keyVal);
      setKeyStatus((prev) => ({ ...prev, [provider]: res }));
    } catch (err) {
      setKeyStatus((prev) => ({ ...prev, [provider]: { valid: false, message: "Connection test failed." } }));
    } finally {
      setTestingKey(null);
    }
  };

  const handleManualReindex = async () => {
    setIsReindexing(true);
    try {
      await scanVault(config, true);
      alert("Vault successfully re-indexed!");
    } catch (err) {
      alert("Re-index failed.");
    } finally {
      setIsReindexing(false);
    }
  };

  // Mouse radial shine effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / rect.width;
    const dy = (e.clientY - rect.top) / rect.height;
    card.style.setProperty("--mx", `${dx * 100}%`);
    card.style.setProperty("--my", `${dy * 100}%`);
  };

  const handleMouseLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--mx", "50%");
    card.style.setProperty("--my", "50%");
  };

  return (
    <div className="w-full max-w-5xl h-[82vh] flex items-center justify-center p-4 z-10 select-none font-sans">
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] p-6 flex flex-col gap-6 shadow-2xl relative overflow-hidden text-[#FFFFE8]"
        style={{
          backgroundImage:
            "radial-gradient(circle 450px at var(--mx, 50%) var(--my, 50%), rgba(160, 84, 141, 0.16) 0%, transparent 80%)",
        }}
      >
        {/* Header */}
        <header className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-[#FFFFE8] tracking-tight flex items-center gap-2">
              <SlidersHorizontal className="w-6 h-6 text-[#A0548D]" />
              Settings & Provider Keys
            </h1>
            <p className="text-xs text-[#FFFFE8]/60 mt-0.5">
              Manage your Obsidian vault defaults, AI API keys, and pipeline rules.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {savedBanner && (
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/30">
                <Check className="w-4 h-4" /> Saved Automatically
              </span>
            )}
            <button
              onClick={handleManualReindex}
              disabled={isReindexing}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? "animate-spin text-[#A0548D]" : ""}`} />
              Re-index Vault
            </button>
          </div>
        </header>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Section 1: API Keys (Client-Side Storage) */}
          <section className="bg-white/5 p-5 rounded-2xl border border-white/10 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4 text-[#A0548D]" /> API Keys & Provider Connections
            </h3>
            <p className="text-xs text-white/50">
              API keys are stored client-side in Tauri secure local storage and transmitted only as request headers.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Gemini Key */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium flex items-center justify-between w-full">
                  <span>Google Gemini API Key</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#A0548D] hover:underline"
                  >
                    Get Key
                  </a>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys.gemini ? "text" : "password"}
                      value={config.geminiKey || ""}
                      onChange={(e) => updateField("geminiKey", e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-white/20 outline-none focus:border-[#A0548D]"
                    />
                    <button
                      onClick={() => setShowKeys((p) => ({ ...p, gemini: !p.gemini }))}
                      className="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                    >
                      {showKeys.gemini ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleTestKey("gemini", config.geminiKey || "")}
                    disabled={testingKey === "gemini"}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    {testingKey === "gemini" ? "Testing..." : "Test"}
                  </button>
                </div>
                {keyStatus.gemini && (
                  <p className={`text-[11px] font-medium flex items-center gap-1 ${keyStatus.gemini.valid ? "text-emerald-400" : "text-red-400"}`}>
                    {keyStatus.gemini.valid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    {keyStatus.gemini.message}
                  </p>
                )}
              </div>

              {/* Tavily Key */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium flex items-center justify-between w-full">
                  <span>Tavily Web Search Key</span>
                  <a
                    href="https://dashboard.tavily.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#A0548D] hover:underline"
                  >
                    Get Key
                  </a>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys.tavily ? "text" : "password"}
                      value={config.tavilyKey || ""}
                      onChange={(e) => updateField("tavilyKey", e.target.value)}
                      placeholder="tvly-..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-white/20 outline-none focus:border-[#A0548D]"
                    />
                    <button
                      onClick={() => setShowKeys((p) => ({ ...p, tavily: !p.tavily }))}
                      className="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                    >
                      {showKeys.tavily ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleTestKey("tavily", config.tavilyKey || "")}
                    disabled={testingKey === "tavily"}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    {testingKey === "tavily" ? "Testing..." : "Test"}
                  </button>
                </div>
                {keyStatus.tavily && (
                  <p className={`text-[11px] font-medium flex items-center gap-1 ${keyStatus.tavily.valid ? "text-emerald-400" : "text-red-400"}`}>
                    {keyStatus.tavily.valid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    {keyStatus.tavily.message}
                  </p>
                )}
              </div>

              {/* Firecrawl Key */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium flex items-center justify-between w-full">
                  <span>Firecrawl Scraping Key</span>
                  <a
                    href="https://www.firecrawl.dev/app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#A0548D] hover:underline"
                  >
                    Get Key
                  </a>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys.firecrawl ? "text" : "password"}
                      value={config.firecrawlKey || ""}
                      onChange={(e) => updateField("firecrawlKey", e.target.value)}
                      placeholder="fc-..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-white/20 outline-none focus:border-[#A0548D]"
                    />
                    <button
                      onClick={() => setShowKeys((p) => ({ ...p, firecrawl: !p.firecrawl }))}
                      className="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                    >
                      {showKeys.firecrawl ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleTestKey("firecrawl", config.firecrawlKey || "")}
                    disabled={testingKey === "firecrawl"}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    {testingKey === "firecrawl" ? "Testing..." : "Test"}
                  </button>
                </div>
                {keyStatus.firecrawl && (
                  <p className={`text-[11px] font-medium flex items-center gap-1 ${keyStatus.firecrawl.valid ? "text-emerald-400" : "text-red-400"}`}>
                    {keyStatus.firecrawl.valid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    {keyStatus.firecrawl.message}
                  </p>
                )}
              </div>

              {/* OpenRouter Key */}
              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium flex items-center justify-between w-full">
                  <span>OpenRouter Key (Optional Fallback)</span>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#A0548D] hover:underline"
                  >
                    Get Key
                  </a>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKeys.openrouter ? "text" : "password"}
                      value={config.openrouterKey || ""}
                      onChange={(e) => updateField("openrouterKey", e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white placeholder-white/20 outline-none focus:border-[#A0548D]"
                    />
                    <button
                      onClick={() => setShowKeys((p) => ({ ...p, openrouter: !p.openrouter }))}
                      className="absolute right-2.5 top-2.5 text-white/40 hover:text-white"
                    >
                      {showKeys.openrouter ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleTestKey("openrouter", config.openrouterKey || "")}
                    disabled={testingKey === "openrouter"}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    {testingKey === "openrouter" ? "Testing..." : "Test"}
                  </button>
                </div>
                {keyStatus.openrouter && (
                  <p className={`text-[11px] font-medium flex items-center gap-1 ${keyStatus.openrouter.valid ? "text-emerald-400" : "text-red-400"}`}>
                    {keyStatus.openrouter.valid ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                    {keyStatus.openrouter.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Section 2: Vault & Output Preferences */}
          <section className="bg-white/5 p-5 rounded-2xl border border-white/10 space-y-4">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#A0548D]" /> Vault & Output Options
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Subfolder Path for Generated Files</label>
                <input
                  type="text"
                  value={config.customSavePath || "/Generated"}
                  onChange={(e) => updateField("customSavePath", e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Filename Convention</label>
                <select
                  value={config.namingConvention || "kebab"}
                  onChange={(e) => updateField("namingConvention", e.target.value)}
                  style={{ colorScheme: "dark" }}
                  className="w-full bg-[#18181c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D] cursor-pointer"
                >
                  <option value="kebab" className="bg-[#121216] text-[#FFFFE8]">kebab-case (my-note-title.md)</option>
                  <option value="title" className="bg-[#121216] text-[#FFFFE8]">Title Case (My Note Title.md)</option>
                  <option value="timestamp" className="bg-[#121216] text-[#FFFFE8]">Timestamp Prefix (20260802-my-note.md)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Default Linking Traversal Depth</label>
                <select
                  value={config.linkingDepth || "deep"}
                  onChange={(e) => updateField("linkingDepth", e.target.value)}
                  style={{ colorScheme: "dark" }}
                  className="w-full bg-[#18181c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D] cursor-pointer"
                >
                  <option value="shallow" className="bg-[#121216] text-[#FFFFE8]">Shallow (Direct neighbors only)</option>
                  <option value="deep" className="bg-[#121216] text-[#FFFFE8]">Deep (Multi-hop graph traversal)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Default Style Preset</label>
                <select
                  value={config.stylePreset || "atomic"}
                  onChange={(e) => updateField("stylePreset", e.target.value)}
                  style={{ colorScheme: "dark" }}
                  className="w-full bg-[#18181c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D] cursor-pointer"
                >
                  <option value="atomic" className="bg-[#121216] text-[#FFFFE8]">Atomic / Zettelkasten (Modular + MOC)</option>
                  <option value="essay" className="bg-[#121216] text-[#FFFFE8]">Long-Form Essay</option>
                  <option value="technical" className="bg-[#121216] text-[#FFFFE8]">Deep Technical Documentation</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Web Search Provider</label>
                <select
                  value={config.searchProvider || "duckduckgo"}
                  onChange={(e) => updateField("searchProvider", e.target.value)}
                  style={{ colorScheme: "dark" }}
                  className="w-full bg-[#18181c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D] cursor-pointer"
                >
                  <option value="duckduckgo" className="bg-[#121216] text-[#FFFFE8]">DuckDuckGo (Free & Local)</option>
                  <option value="tavily" className="bg-[#121216] text-[#FFFFE8]">Tavily AI Search (Requires API Key)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-white/80 font-medium">Web Scraping Engine</label>
                <select
                  value={config.scrapeProvider || "crawl4ai"}
                  onChange={(e) => updateField("scrapeProvider", e.target.value)}
                  style={{ colorScheme: "dark" }}
                  className="w-full bg-[#18181c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#A0548D] cursor-pointer"
                >
                  <option value="crawl4ai" className="bg-[#121216] text-[#FFFFE8]">Crawl4AI (Local Headless Browser)</option>
                  <option value="httpx" className="bg-[#121216] text-[#FFFFE8]">HTTPX Static Scraper (Fast & Free)</option>
                  <option value="firecrawl" className="bg-[#121216] text-[#FFFFE8]">Firecrawl Cloud API (Requires API Key)</option>
                </select>
              </div>
            </div>
          </section>

          {/* Section 3: Memory Layer (Section 15) */}
          <section className="bg-white/5 p-5 rounded-2xl border border-white/10 space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[#A0548D]" /> User Memory & AI Context
                </h3>
                <p className="text-xs text-white/50 mt-1">
                  Durable user preferences and recurring guidelines extracted automatically from notes or set manually.
                </p>
              </div>
              
              {/* Scope selectors */}
              <div className="flex bg-black/40 border border-white/10 rounded-xl p-1 shrink-0">
                <button
                  onClick={() => setActiveMemoryScope("vault")}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeMemoryScope === "vault"
                      ? "bg-[#A0548D] text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  This Vault
                </button>
                <button
                  onClick={() => setActiveMemoryScope("global")}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    activeMemoryScope === "global"
                      ? "bg-[#A0548D] text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  Global Scope
                </button>
              </div>
            </div>

            {/* List of Memories */}
            {isLoadingMemories ? (
              <div className="text-center py-6 text-xs text-white/40">
                Loading memory records...
              </div>
            ) : memories.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-white/10 rounded-xl text-xs text-white/40">
                No memories recorded in this scope yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                {memories.map((mem) => (
                  <div
                    key={mem.id}
                    className="flex items-center justify-between bg-black/30 border border-white/5 hover:border-white/10 p-3.5 rounded-xl transition-all"
                  >
                    <div className="flex-1 space-y-1 pr-4">
                      <p className="text-xs font-medium text-white/90 leading-relaxed">
                        {mem.content}
                      </p>
                      <div className="flex items-center gap-2">
                        {mem.memory_type && (
                          <span className="text-[10px] bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-md font-mono">
                            {mem.memory_type}
                          </span>
                        )}
                        <span className="text-[10px] text-white/40">
                          {new Date(mem.created_at).toLocaleDateString()}
                        </span>
                        {mem.status === "pending" && (
                          <span className="text-[9px] bg-purple-500/10 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded-md font-semibold tracking-wider uppercase flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> New Fact
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {mem.status === "pending" && (
                        <button
                          onClick={() => handleConfirmMemory(mem.id)}
                          title="Confirm fact to remember permanently"
                          className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg transition-all cursor-pointer"
                        >
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        title="Forget this memory"
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg transition-all cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
};
