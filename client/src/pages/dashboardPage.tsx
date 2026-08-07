import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  Folder,
  FolderPlus,
  RefreshCw,
  Trash2,
  Activity,
  Layers,
  Link as LinkIcon,
  Calendar,
  FolderOpen,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  scanVault,
  getStoredVaultConfig,
  saveVaultConfig,
} from "../lib/api";


interface LinkedVault {
  id: string;
  path: string;
  name: string;
  totalNotes: number;
  totalLinks: number;
  lastIndexed: string;
}

export const DashboardPage: React.FC = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [linkedVaults, setLinkedVaults] = useState<LinkedVault[]>([]);
  const [activeVaultPath, setActiveVaultPath] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<string | null>(null); // path of currently indexing vault

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

  // Load linked vaults and active vault
  const loadVaults = async () => {
    const activeConfig = getStoredVaultConfig();
    const activePath = activeConfig?.vaultPath || "/home/mihir/Documents/Obsidian/DSA/DSA";
    setActiveVaultPath(activePath);

    const stored = localStorage.getItem("vault_agent_linked_vaults");
    let list: LinkedVault[] = [];

    if (stored) {
      try {
        list = JSON.parse(stored);
        let migrated = false;
        list = list.map((v: any) => {
          if (!v.id) {
            v.id = crypto.randomUUID();
            migrated = true;
          }
          return v;
        });
        if (migrated) {
          localStorage.setItem("vault_agent_linked_vaults", JSON.stringify(list));
        }
      } catch (e) {
        console.error("Failed to parse linked vaults list:", e);
      }
    }

    // Fallback: If list is empty, initialize it with the active vault path
    if (list.length === 0 && activePath) {
      const folderName = activePath.split("/").pop() || "Active Vault";
      let activeId = activeConfig?.vaultId;
      if (!activeId) {
        activeId = crypto.randomUUID();
        if (activeConfig) {
          activeConfig.vaultId = activeId;
          saveVaultConfig(activeConfig);
        }
      }
      list = [
        {
          id: activeId,
          path: activePath,
          name: folderName,
          totalNotes: 0,
          totalLinks: 0,
          lastIndexed: new Date().toLocaleDateString(),
        },
      ];
      localStorage.setItem("vault_agent_linked_vaults", JSON.stringify(list));
    }

    setLinkedVaults(list);
  };

  useEffect(() => {
    loadVaults();
  }, []);

  // Scan and update stats of a specific vault
  const handleIndexVault = async (path: string) => {
    setIsSyncing(path);
    try {
      const config = {
        vaultPath: path,
        excludedFolders: ["Templates", "Attachments", ".trash", ".obsidian"],
      };

      // Trigger scan
      const scanRes = await scanVault(config, true);
      
      // Update entry in linked list
      const updated = linkedVaults.map((v) => {
        if (v.path === path) {
          return {
            ...v,
            totalNotes: scanRes.real_files || scanRes.nodes,
            totalLinks: scanRes.edges,
            lastIndexed: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
        }
        return v;
      });

      setLinkedVaults(updated);
      localStorage.setItem("vault_agent_linked_vaults", JSON.stringify(updated));

      // If this is the active vault, also trigger local nodes reload
      if (path === activeVaultPath) {
        saveVaultConfig(config);
      }
    } catch (err) {
      console.error("Failed to index vault:", err);
    } finally {
      setIsSyncing(null);
    }
  };

  // Switch active vault
  const handleSelectVault = (path: string) => {
    const existing = linkedVaults.find((v) => v.path === path);
    const storedConfig = getStoredVaultConfig() || {};
    const config = {
      ...storedConfig,
      vaultPath: path,
      vaultId: existing ? existing.id : crypto.randomUUID(),
    };
    saveVaultConfig(config as any);
    setActiveVaultPath(path);

    // Navigate to discovery explorer page
    navigate("/discovery");
  };

  // Link a new vault
  const handleLinkNewVault = async () => {
    navigate("/setup");
  };

  // Unlink a vault
  const handleUnlinkVault = (e: React.MouseEvent, path: string) => {
    e.stopPropagation(); // prevent card click select trigger
    if (path === activeVaultPath) {
      alert("Cannot unlink the currently active vault. Switch to another vault first.");
      return;
    }

    const updated = linkedVaults.filter((v) => v.path !== path);
    setLinkedVaults(updated);
    localStorage.setItem("vault_agent_linked_vaults", JSON.stringify(updated));
  };

  return (
    <div className="w-full max-w-5xl h-[82vh] flex items-center justify-center p-4 z-10 select-none font-sans">
      {/* Main Glass Card with Mouse Radial Glow */}
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] p-6 flex flex-col gap-6 shadow-2xl relative overflow-hidden transition-shadow duration-300 text-[#FFFFE8]"
        style={{
          backgroundImage:
            "radial-gradient(circle 450px at var(--mx, 50%) var(--my, 50%), rgba(160, 84, 141, 0.16) 0%, transparent 80%)",
        }}
      >
        {/* Header section */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-[#FFFFE8] tracking-tight font-sans flex items-center gap-2">
              <Layers className="w-6 h-6 text-[#A0548D]" />
              Workspaces & Linked Vaults
            </h1>
            <p className="text-xs text-[#FFFFE8]/60 mt-0.5 font-sans">
              Switch, index, and manage your Obsidian vaults or local markdown folder projects.
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleLinkNewVault}
            className="flex items-center gap-1.5 bg-[#A0548D] hover:bg-[#884377] text-white px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-lg cursor-pointer font-sans"
          >
            <FolderPlus className="w-4 h-4" />
            Link New Vault
          </motion.button>
        </header>

        {/* Vaults Grid List */}
        <div className="flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {linkedVaults.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-3">
              <FolderOpen className="w-12 h-12 text-white/20 animate-pulse" />
              <p className="text-sm text-white/50 italic">No linked vault workspaces. Click above to add one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {linkedVaults.map((vault) => {
                const isActive = vault.path === activeVaultPath;
                const isIndexing = isSyncing === vault.path;

                return (
                  <motion.div
                    key={vault.path}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSelectVault(vault.path)}
                    className={`relative p-5 bg-white/5 rounded-2xl border transition-all duration-300 cursor-pointer flex flex-col gap-4 group ${
                      isActive
                        ? "border-[#A0548D] bg-[#A0548D]/10 shadow-[0_0_20px_rgba(160,84,141,0.25)]"
                        : "border-white/10 hover:border-[#A0548D]/40 hover:bg-white/10 hover:shadow-[0_0_15px_rgba(160,84,141,0.15)]"
                    }`}
                  >


                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 truncate">
                        <div className={`p-2 rounded-xl bg-white/5 ${isActive ? "text-[#A0548D]" : "text-white/40"}`}>
                          <Folder className="w-5 h-5" />
                        </div>
                        <div className="truncate">
                          <h3 className="font-semibold text-sm text-[#FFFFE8] truncate group-hover:text-white transition-colors">
                            {vault.name}
                          </h3>
                          <p className="text-[10px] text-white/40 truncate font-mono mt-0.5">
                            {vault.path}
                          </p>
                        </div>
                      </div>
                      {/* Active status is highlighted by card border/glow, no extra pill needed */}
                    </div>


                    {/* Stats Badges Row */}
                    <div className="flex items-center gap-4 text-xs text-[#FFFFE8]/70 border-t border-white/5 pt-3">
                      <div className="flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5 text-[#A0548D]" />
                        <span>{vault.totalNotes} Notes</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <LinkIcon className="w-3.5 h-3.5 text-[#A0548D]" />
                        <span>{vault.totalLinks} Edges</span>
                      </div>
                    </div>

                    {/* Footer Row */}
                    <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3 mt-auto">
                      <div className="flex items-center gap-1 text-[10px] text-white/40">
                        <Calendar className="w-3 h-3" />
                        <span>Indexed: {vault.lastIndexed}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Index Button */}
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleIndexVault(vault.path);
                          }}
                          disabled={isIndexing}
                          title="Re-index Vault"
                          className="p-1.5 bg-white/5 hover:bg-[#A0548D]/30 border border-white/10 text-white rounded-lg transition-all cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isIndexing ? "animate-spin text-[#A0548D]" : ""}`} />
                        </motion.button>

                        {/* Unlink Button */}
                        {!isActive && (
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => handleUnlinkVault(e, vault.path)}
                            title="Unlink Workspace"
                            className="p-1.5 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-white hover:text-red-400 rounded-lg transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
