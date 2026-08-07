import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  FolderOpen, PlusCircle, X, 
  Key, Layers, FileText, CheckCircle, AlertTriangle 
} from "lucide-react";

import { gsap } from "gsap";
import Stepper, { Step } from "../components/Stepper";
import { saveVaultConfig, scanVault } from "../lib/api";
import { saveSecret, getSecret } from "../lib/secrets";

const Setuppage: React.FC = () => {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);

  // Wizard Steps (1 to 6)
  const [step, setStep] = useState(1);

  // --- Step 1: Vault Selection states ---

  const [vaultPath, setVaultPath] = useState("");
  const [vaultType, setVaultType] = useState<"existing" | "new" | null>(null);
  const [newVaultName, setNewVaultName] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [showValidationWarning, setShowValidationWarning] = useState(false);

  // --- Step 2: Excluded Folders states ---
  const [excludedFolders, setExcludedFolders] = useState<string[]>([
    "Templates",
    "Attachments",
    ".trash",
    ".obsidian"
  ]);
  const [newExcludedInput, setNewExcludedInput] = useState("");

  // --- Step 3: Default Save Folder states ---
  const [saveLocationType, setSaveLocationType] = useState<"root" | "custom">("root");
  const [customSavePath, setCustomSavePath] = useState("/Generated");

  // --- Step 4: Frontmatter & Naming states ---
  const [namingConvention, setNamingConvention] = useState<"kebab" | "title" | "timestamp">("kebab");
  const [dateFormat, setDateFormat] = useState<"YYYY-MM-DD" | "ISO">("YYYY-MM-DD");
  const [frontmatterKeys, setFrontmatterKeys] = useState<string[]>([
    "tags",
    "created",
    "source",
    "status"
  ]);
  const [newKeyInput, setNewKeyInput] = useState("");

  // --- Step 5: Default Style & Linking states ---
  const [stylePreset, setStylePreset] = useState<"atomic" | "long" | "deep">("atomic");
  const [linkingDepth, setLinkingDepth] = useState<"shallow" | "deep">("deep");

  const [geminiKey, setGeminiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");

  // Auto-indexing state (global utility)
  const [autoIndexOnLaunch, setAutoIndexOnLaunch] = useState(true);

  // Shine gradient movement (no card movement/rotation)
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();

    // Shine gradient movement
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

  // --- Folder Picker utility ---
  const handleSelectFolder = async () => {
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const selected = await dialog.open({ directory: true, multiple: false });
      if (selected) {
        setVaultPath(selected as string);
        setVaultType("existing");
      }
    } catch (err) {
      console.warn("Tauri dialog plugin not available, using prompt fallback", err);
      const path = prompt("Enter local folder path manually:", "/home/user/my-vault");
      if (path) {
        setVaultPath(path);
        setVaultType("existing");
      }
    }
  };

  const handleSelectNewVaultFolder = async () => {
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const selected = await dialog.open({ directory: true, multiple: false });
      if (selected) {
        setVaultPath(selected as string);
        setVaultType("new");
      }
    } catch (err) {
      console.warn("Tauri dialog plugin not available, using prompt fallback", err);
      const path = prompt("Enter folder path where new vault should be created:", "/home/user");
      if (path) {
        setVaultPath(path);
        setVaultType("new");
      }
    }
  };

  // Exit transition state
  const [_isExiting, setIsExiting] = useState(false);



  // --- Final Onboarding Submission ---
  const handleCompleteSetup = async () => {
    // Save keys securely in stronghold
    try {
      await saveSecret("openrouterKey", openrouterKey);
      await saveSecret("geminiKey", geminiKey);
    } catch (err) {
      console.error("Failed to save keys securely:", err);
    }

    let vaultId = crypto.randomUUID();
    try {
      const storedLinked = localStorage.getItem("vault_agent_linked_vaults");
      if (storedLinked) {
        const linkedList = JSON.parse(storedLinked);
        const existing = linkedList.find((v: any) => v.path === vaultPath);
        if (existing) {
          vaultId = existing.id;
        }
      }
    } catch (e) {}

    const config = {
      vaultPath,
      vaultId,
      excludedFolders,
      saveLocationType,
      customSavePath,
      namingConvention,
      dateFormat,
      frontmatterKeys,
      stylePreset,
      linkingDepth,
      geminiKey: "", // Store as empty string to prevent plain text leaks
      openrouterKey: "", // Store as empty string to prevent plain text leaks
      autoIndexOnLaunch,
    };

    // Save configuration locally
    saveVaultConfig(config);

    // Add to linked vaults in localStorage
    try {
      const storedLinked = localStorage.getItem("vault_agent_linked_vaults");
      let linkedList = [];
      if (storedLinked) {
        linkedList = JSON.parse(storedLinked);
      }
      if (!linkedList.some((v: any) => v.path === vaultPath)) {
        const folderName = vaultPath.split(/[/\\]/).pop() || "Unnamed Vault";
        linkedList.push({
          id: vaultId,
          path: vaultPath,
          name: folderName,
          totalNotes: 0,
          totalLinks: 0,
          lastIndexed: new Date().toLocaleDateString(),
        });
        localStorage.setItem("vault_agent_linked_vaults", JSON.stringify(linkedList));
      }
    } catch (e) {
      console.error("Failed to update linked vaults list:", e);
    }

    // Trigger backend indexing scan if vault path is configured
    if (vaultPath) {
      // Pass the actual keys temporarily to the scan function
      const scanConfig = {
        ...config,
        geminiKey,
        openrouterKey,
      };
      scanVault(scanConfig).catch((err) => {
        console.warn("[VaultAgent] Initial indexer scan request warning:", err);
      });
    }

    setIsExiting(true);
    if (cardRef.current) {
      gsap.to(cardRef.current, {
        opacity: 0,
        y: -20,
        scale: 0.98,
        duration: 0.6,
        ease: "power3.inOut",
        onComplete: () => {
          // Navigate to dashboard page after completing setup
          navigate("/dashboard");
        },
      });
    } else {
      navigate("/dashboard");
    }


  };

  // Stagger entry animations on mount
  useEffect(() => {
    if (cardRef.current) {
      gsap.fromTo(
        cardRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 1.0, ease: "power3.out" }
      );
    }

    const loadSecrets = async () => {
      try {
        const orKey = await getSecret("openrouterKey");
        const gemKey = await getSecret("geminiKey");
        if (orKey) setOpenrouterKey(orKey);
        if (gemKey) setGeminiKey(gemKey);
      } catch (err) {
        console.error("Failed to load keys from secure store:", err);
      }
    };
    loadSecrets();
  }, []);



  // Exclude folder helpers
  const handleAddExcluded = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newExcludedInput.trim()) {
      e.preventDefault();
      if (!excludedFolders.includes(newExcludedInput.trim())) {
        setExcludedFolders([...excludedFolders, newExcludedInput.trim()]);
      }
      setNewExcludedInput("");
    }
  };

  const handleRemoveExcluded = (folder: string) => {
    setExcludedFolders(excludedFolders.filter((f) => f !== folder));
  };

  // Frontmatter keys helpers
  const handleAddKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newKeyInput.trim()) {
      e.preventDefault();
      if (!frontmatterKeys.includes(newKeyInput.trim())) {
        setFrontmatterKeys([...frontmatterKeys, newKeyInput.trim()]);
      }
      setNewKeyInput("");
    }
  };

  const handleRemoveKey = (keyName: string) => {
    setFrontmatterKeys(frontmatterKeys.filter((k) => k !== keyName));
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center py-12 px-6 md:px-0 z-10 overflow-y-auto custom-scrollbar select-none">
      {/* Onboarding Wizard Card */}
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full max-w-2xl bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] p-8 md:p-12 flex flex-col gap-6 shadow-2xl relative transition-shadow duration-300 hover:shadow-accent/5 overflow-hidden"
        style={{
          backgroundImage: "radial-gradient(circle 350px at var(--mx, 50%) var(--my, 50%), rgba(160, 84, 141, 0.16) 0%, transparent 80%)"
        }}
      >
        <Stepper
          step={step}
          onStepChange={(s) => setStep(s)}
          onFinalStepCompleted={handleCompleteSetup}
          onBeforeNext={async (s) => {
            if (s === 1) {
              if (!vaultPath) return false;
              setIsValidating(true);
              // Simulate check
              await new Promise((resolve) => setTimeout(resolve, 800));
              setIsValidating(false);
              
              const isPlainFolder = !vaultPath.endsWith(".obsidian") && !vaultPath.includes("vault");
              if (vaultType === "existing" && isPlainFolder) {
                setShowValidationWarning(true);
                return false;
              }
            }
            return true;
          }}
          nextButtonText={isValidating ? "Validating..." : "Continue"}
          disableStepIndicators={showValidationWarning}
        >
          {/* STEP 1: Vault Selection & Validation */}
          <Step>
            <div className="flex flex-col gap-6 pt-2">
              <header className="flex flex-col items-center text-center gap-3">
                
                <h1 className="text-3xl font-semibold text-secondry tracking-tight font-sans">
                  Welcome to VaultAgent
                </h1>
                <p className="text-secondry/60 text-sm max-w-md leading-relaxed font-sans">
                  Notes making and research made easier. In your Favourite style.
                </p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={handleSelectFolder}
                  className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border text-center transition-all ${
                    vaultType === "existing"
                      ? "bg-accent/15 border-accent shadow-[0_0_15px_rgba(160,84,141,0.2)] text-secondry"
                      : "bg-white/5 border-white/5 text-secondry/70 hover:bg-white/10 hover:border-white/10"
                  } cursor-pointer group`}
                >
                  <FolderOpen className="w-8 h-8 text-accent group-hover:scale-110 transition-transform" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">Select Existing Vault</span>
                    <span className="text-[10px] opacity-60">Pick folder from file system</span>
                  </div>
                </button>

                <button
                  onClick={handleSelectNewVaultFolder}
                  className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border text-center transition-all ${
                    vaultType === "new"
                      ? "bg-accent/15 border-accent shadow-[0_0_15px_rgba(160,84,141,0.2)] text-secondry"
                      : "bg-white/5 border-white/5 text-secondry/70 hover:bg-white/10 hover:border-white/10"
                  } cursor-pointer group`}
                >
                  <PlusCircle className="w-8 h-8 text-accent group-hover:scale-110 transition-transform" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">Create New Vault</span>
                    <span className="text-[10px] opacity-60">Create fresh index directory</span>
                  </div>
                </button>
              </div>

              {vaultType === "new" && (
                <div className="flex flex-col gap-2 p-4 rounded-xl bg-white/5 border border-white/5 animate-in fade-in duration-300">
                  <label className="text-xs font-sans text-secondry/50">New Vault Name</label>
                  <input
                    type="text"
                    value={newVaultName}
                    onChange={(e) => setNewVaultName(e.target.value)}
                    placeholder="E.g., KnowledgeBase"
                    className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm text-secondry outline-none focus:border-accent/40"
                  />
                </div>
              )}

              {vaultPath && (
                <div className="text-xs font-sans text-secondry/40 bg-black/25 p-3.5 rounded-xl border border-white/5 flex flex-col gap-1 overflow-hidden text-ellipsis">
                  <span className="font-bold text-accent/80 uppercase tracking-wider text-[10px]">Active Path:</span>
                  <span className="break-all">{vaultPath}</span>
                </div>
              )}

              {showValidationWarning && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-3 animate-in slide-in-from-top-4 duration-300">
                  <div className="flex items-center gap-2.5 text-amber-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-semibold">Not an Obsidian Vault</span>
                  </div>
                  <p className="text-xs text-secondry/70 leading-normal">
                    This directory does not contain a <code className="text-amber-300">.obsidian/</code> settings folder. Do you want to initialize a fresh settings configuration here, or index it as a plain markdown folder?
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1.5">
                    <button
                      onClick={() => {
                        setShowValidationWarning(false);
                        setStep(2);
                      }}
                      className="bg-amber-500/20 border border-amber-500/40 text-amber-200 px-3 py-1.5 rounded-lg text-xs hover:bg-amber-500/30 cursor-pointer transition-colors"
                    >
                      Initialize Obsidian
                    </button>
                    <button
                      onClick={() => {
                        setShowValidationWarning(false);
                        setStep(2);
                      }}
                      className="bg-white/5 border border-white/10 text-secondry/80 px-3 py-1.5 rounded-lg text-xs hover:bg-white/10 cursor-pointer transition-colors"
                    >
                      Use as Plain Markdown
                    </button>
                    <button
                      onClick={() => {
                        setShowValidationWarning(false);
                        setVaultPath("");
                        setVaultType(null);
                      }}
                      className="text-secondry/40 hover:text-secondry text-xs px-2 py-1.5 cursor-pointer"
                    >
                      Select Different Folder
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Step>

          {/* STEP 2: Excluded Folders */}
          <Step>
            <div className="flex flex-col gap-6">
              <header className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-secondry font-sans flex items-center gap-2">
                  <Layers className="w-5 h-5 text-accent" />
                  Excluded Folders
                </h2>
                <p className="text-xs text-secondry/50 leading-relaxed font-sans">
                  Optimize indexing performance. Select which directories the Agent should ignore (templates, assets, or trash).
                </p>
              </header>

              <div className="flex flex-wrap gap-2.5">
                {["Templates", "Attachments", ".trash", ".obsidian", "node_modules", "Backup"].map((preset) => {
                  const isSelected = excludedFolders.includes(preset);
                  return (
                    <button
                      key={preset}
                      onClick={() => {
                        if (isSelected) {
                          setExcludedFolders(excludedFolders.filter((f) => f !== preset));
                        } else {
                          setExcludedFolders([...excludedFolders, preset]);
                        }
                      }}
                      className={`text-xs px-3.5 py-2 rounded-full border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-accent/15 border-accent text-accent font-semibold"
                          : "bg-white/5 border-white/5 text-secondry/60 hover:bg-white/10"
                      }`}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-sans text-secondry/50 px-1">
                  Custom Excluded Folders
                </label>
                <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-black/35 border border-white/5 focus-within:border-accent/40 transition-colors">
                  {excludedFolders.map((folder) => (
                    <div
                      key={folder}
                      className="flex items-center gap-1.5 bg-accent/10 border border-accent/25 text-accent px-3 py-1 rounded-full text-xs font-sans"
                    >
                      <span>{folder}</span>
                      <button
                        onClick={() => handleRemoveExcluded(folder)}
                        className="hover:text-secondry transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <input
                    type="text"
                    value={newExcludedInput}
                    onChange={(e) => setNewExcludedInput(e.target.value)}
                    onKeyDown={handleAddExcluded}
                    className="bg-transparent border-none outline-none focus:ring-0 text-xs text-secondry p-0 grow min-w-30"

                    placeholder="Add folder... [Enter]"
                  />
                </div>
              </div>
            </div>
          </Step>

          {/* STEP 3: Default Save Folder */}
          <Step>
            <div className="flex flex-col gap-6">
              <header className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-secondry font-sans flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-accent" />
                  Default Save Location
                </h2>
                <p className="text-xs text-secondry/50 leading-relaxed font-sans">
                  Choose where your research notes and generated summaries should be saved by default.
                </p>
              </header>

              <div className="flex flex-col gap-4">
                <button
                  onClick={() => setSaveLocationType("root")}
                  className={`flex items-center justify-between p-5 rounded-2xl border text-left transition-all ${
                    saveLocationType === "root"
                      ? "bg-accent/15 border-accent shadow-[0_0_15px_rgba(160,84,141,0.2)] text-secondry"
                      : "bg-white/5 border-white/5 text-secondry/70 hover:bg-white/10"
                  } cursor-pointer`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">Vault Root Folder</span>
                    <span className="text-xs opacity-60">Saves notes directly in "/"</span>
                  </div>
                  <CheckCircle className={`w-5 h-5 ${saveLocationType === "root" ? "text-accent opacity-100" : "opacity-0"}`} />
                </button>

                <button
                  onClick={() => setSaveLocationType("custom")}
                  className={`flex items-center justify-between p-5 rounded-2xl border text-left transition-all ${
                    saveLocationType === "custom"
                      ? "bg-accent/15 border-accent shadow-[0_0_15px_rgba(160,84,141,0.2)] text-secondry"
                      : "bg-white/5 border-white/5 text-secondry/70 hover:bg-white/10"
                  } cursor-pointer`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">Custom Subfolder</span>
                    <span className="text-xs opacity-60">Saves inside a dedicated subdirectory</span>
                  </div>
                  <CheckCircle className={`w-5 h-5 ${saveLocationType === "custom" ? "text-accent opacity-100" : "opacity-0"}`} />
                </button>
              </div>

              {saveLocationType === "custom" && (
                <div className="flex flex-col gap-2 p-4 rounded-xl bg-white/5 border border-white/5 animate-in fade-in duration-300">
                  <label className="text-xs font-sans text-secondry/50">Subfolder Name</label>
                  <input
                    type="text"
                    value={customSavePath}
                    onChange={(e) => setCustomSavePath(e.target.value)}
                    placeholder="E.g., /Research/Generated"
                    className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm text-secondry outline-none focus:border-accent/40"
                  />
                </div>
              )}
            </div>
          </Step>

          {/* STEP 4: Frontmatter Schema & Naming Conventions */}
          <Step>
            <div className="flex flex-col gap-5">
              <header className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-secondry font-sans flex items-center gap-2">
                  <FileText className="w-5 h-5 text-accent" />
                  Frontmatter & Naming
                </h2>
                <p className="text-xs text-secondry/50 leading-relaxed font-sans">
                  Specify how metadata parameters should be formatted inside generated notes.
                </p>
              </header>

              {/* Naming Convention Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-sans tracking-widest text-secondry/50">
                  File Naming Convention
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "kebab", label: "kebab-case", desc: "note-title.md" },
                    { id: "title", label: "Title Case", desc: "Note Title.md" },
                    { id: "timestamp", label: "Timestamped", desc: "20260710-note.md" }
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setNamingConvention(preset.id as any)}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                        namingConvention === preset.id
                          ? "bg-accent/15 border-accent text-secondry"
                          : "bg-white/5 border-white/5 text-secondry/60 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-xs font-semibold">{preset.label}</span>
                      <span className="text-[9px] opacity-40 font-sans mt-0.5">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Format Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-sans tracking-widest text-secondry/50">
                  YAML Date Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "YYYY-MM-DD", label: "Standard Date", desc: "2026-07-10" },
                    { id: "ISO", label: "ISO Timestamp", desc: "2026-07-10T14:14:08Z" }
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setDateFormat(preset.id as any)}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                        dateFormat === preset.id
                          ? "bg-accent/15 border-accent text-secondry"
                          : "bg-white/5 border-white/5 text-secondry/60 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-xs font-semibold">{preset.label}</span>
                      <span className="text-[9px] opacity-40 font-sans mt-0.5">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Frontmatter Tag Customization */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-sans tracking-widest text-secondry/50">
                  Global Frontmatter Keys
                </label>
                <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-black/35 border border-white/5 focus-within:border-accent/40 transition-colors">
                  {frontmatterKeys.map((keyName) => (
                    <div
                      key={keyName}
                      className="flex items-center gap-1.5 bg-accent/10 border border-accent/25 text-accent px-3 py-1 rounded-full text-xs font-sans"
                    >
                      <span>{keyName}</span>
                      <button
                        onClick={() => handleRemoveKey(keyName)}
                        className="hover:text-secondry transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <input
                    type="text"
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    onKeyDown={handleAddKey}
                    className="bg-transparent border-none outline-none focus:ring-0 text-xs text-secondry p-0 grow min-w-30"

                    placeholder="Add field... [Enter]"
                  />
                </div>
              </div>
            </div>
          </Step>

          {/* STEP 5: Default Presets & Linking Depth */}
          <Step>
            <div className="flex flex-col gap-6">
              <header className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-secondry font-sans flex items-center gap-2">
                  <Layers className="w-5 h-5 text-accent" />
                  Default Style & Links
                </h2>
                <p className="text-xs text-secondry/50 leading-relaxed font-sans">
                  Choose default configurations for generating links and styling research outputs.
                </p>
              </header>

              {/* Style Presets */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-sans tracking-widest text-secondry/50">
                  Default Style Preset
                </label>
                <div className="flex flex-col gap-2.5">
                  {[
                    { id: "atomic", title: "Atomic / Zettelkasten", desc: "Single concept notes, highly connected structure" },
                    { id: "long", title: "Long-Form", desc: "Comprehensive structural documents, linear flow" },
                    { id: "deep", title: "Deep Technical", desc: "Highly analytical technical sheets with details" }
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setStylePreset(preset.id as any)}
                      className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        stylePreset === preset.id
                          ? "bg-accent/15 border-accent text-secondry"
                          : "bg-white/5 border-white/5 text-secondry/65 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">{preset.title}</span>
                        <span className="text-[10px] opacity-50 mt-0.5">{preset.desc}</span>
                      </div>
                      <CheckCircle className={`w-4 h-4 ${stylePreset === preset.id ? "text-accent opacity-100" : "opacity-0"}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Linking Depth */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase font-sans tracking-widest text-secondry/50">
                  Default Linking Depth
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "shallow", title: "Shallow Keyword", desc: "Matches explicit words only" },
                    { id: "deep", title: "Deep Contextual", desc: "Extracts semantic references" }
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setLinkingDepth(preset.id as any)}
                      className={`flex flex-col p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        linkingDepth === preset.id
                          ? "bg-accent/15 border-accent text-secondry"
                          : "bg-white/5 border-white/5 text-secondry/60 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-xs font-semibold">{preset.title}</span>
                      <span className="text-[10px] opacity-40 mt-1 leading-snug">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Step>

          {/* STEP 6: API Keys Configuration */}
          <Step>
            <div className="flex flex-col gap-5">
              <header className="flex flex-col gap-1.5">
                <h2 className="text-xl font-bold text-secondry font-sans flex items-center gap-2">
                  <Key className="w-5 h-5 text-accent" />
                  API Keys Setup
                </h2>
                <p className="text-xs text-secondry/50 leading-relaxed font-sans">
                  Enter your API keys to authorize model generations. These are stored locally and encrypted.
                </p>
              </header>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-sans text-secondry/50">Gemini Key (Optional)</label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm text-secondry outline-none focus:border-accent/40 font-sans"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-sans text-secondry/50">OpenRouter Key (Optional)</label>
                  <input
                    type="password"
                    value={openrouterKey}
                    onChange={(e) => setOpenrouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm text-secondry outline-none focus:border-accent/40 font-sans"
                  />
                </div>
              </div>

              {/* Side Note */}
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 text-[11px] text-secondry/40 leading-relaxed">
                <span className="font-semibold text-accent/80">Side Note: </span>
                If left empty, default keys configured in global settings will be utilized for research generations automatically.
              </div>

              {/* Auto indexing toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-sans font-medium text-secondry">Auto-Index on Startup</span>
                  <span className="text-[10px] text-secondry/40 leading-snug">Automatically sync file changes on launch</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoIndexOnLaunch}
                    onChange={() => setAutoIndexOnLaunch(!autoIndexOnLaunch)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-secondry after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>

                </label>
              </div>
            </div>
          </Step>
        </Stepper>

      </div>
    </div>
  );
};

export default Setuppage;