import React, { useEffect, useState } from "react";
import { getStoredVaultConfig, VaultConfig } from "../lib/api";
import Promptbox from "../components/promptbox";
import { LiveProcessReview } from "../components/LiveProcessReview";
import { Folder, Database, Shield, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PromptPage: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [vaultStats, setVaultStats] = useState<{ name: string; totalNotes: number; totalLinks: number } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    const activeConfig = getStoredVaultConfig();
    setConfig(activeConfig);
    
    if (activeConfig?.vaultPath) {
      const stored = localStorage.getItem("vault_agent_linked_vaults");
      if (stored) {
        try {
          const list = JSON.parse(stored);
          const active = list.find((v: any) => v.path === activeConfig.vaultPath);
          if (active) {
            setVaultStats({
              name: active.name,
              totalNotes: active.totalNotes || 0,
              totalLinks: active.totalLinks || 0
            });
          }
        } catch (e) {
          console.error("Failed to parse linked vaults for prompt page:", e);
        }
      }
    }
  }, []);

  const vaultName = config?.vaultPath ? config.vaultPath.split("/").pop() || "Active Vault" : "No Vault Selected";

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none flex flex-col justify-between">
      {/* Top Left Vault Info & Stats Header */}
      {config && (
        <div className="absolute top-6 left-6 z-20 flex flex-col gap-1.5 bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-xl text-secondry text-xs max-w-sm pointer-events-auto">
          {/* Title & Name */}
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#A0548D]" />
            <span className="font-semibold text-white tracking-wide uppercase">{vaultName}</span>
          </div>
          
          {/* Path */}
          <div className="flex items-center gap-2 max-w-xs truncate">
            <Folder className="w-4 h-4 text-secondry/40 shrink-0" />
            <span className="text-secondry/60 truncate">{config.vaultPath}</span>
          </div>

          {/* UUID */}
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-secondry/40" />
            <span className="text-secondry/40 text-[10px] select-all">{config.vaultId || "NO-UUID"}</span>
          </div>

          {/* Considering Stats (Unified here, no green dot) */}
          {vaultStats && (
            <div className="flex items-center gap-2 border-t border-white/10 pt-2 mt-0.5 text-secondry/80">
              <BookOpen className="w-4 h-4 text-secondry" />
              <span>Considering <strong>{vaultStats.totalNotes}</strong> notes and <strong>{vaultStats.totalLinks}</strong> links</span>
            </div>
          )}
        </div>
      )}

      {/* Main Prompt Box Centered */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-full flex justify-center pointer-events-none">
        <div className="w-full flex justify-center pointer-events-auto">
          <Promptbox setActiveSessionId={setActiveSessionId} />
        </div>
      </div>

      {/* Live Agent Progress Panel — Rendered as root-level fixed child to avoid transform container clipping */}
      {activeSessionId && (
        <LiveProcessReview
          sessionId={activeSessionId}
          onClose={() => setActiveSessionId(null)}
          onSaved={() => {
            setActiveSessionId(null);
            navigate("/discovery");
          }}
        />
      )}
    </div>
  );
};

export default PromptPage;
