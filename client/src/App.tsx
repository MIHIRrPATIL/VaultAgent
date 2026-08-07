import { useState, useEffect } from "react";
import "./App.css";
import BlobBackground from "./components/blobbackground.tsx";
import PillNav from "./components/PillNav.tsx";
import LaserFlow from "./components/LaserFlow.tsx";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import PromptPage from "./pages/promptPage.tsx";
import Setuppage from "./pages/setupPage.tsx";
import { DiscoveryPage } from "./pages/discoveryPage.tsx";
import { DashboardPage } from "./pages/dashboardPage.tsx";
import { SettingsPage } from "./pages/settingsPage.tsx";
import { ChatsPage } from "./pages/chatsPage.tsx";
import { getStoredVaultConfig } from "./lib/api";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Smart Root Redirect based on user vault setup status
const RootRedirect = () => {
  const config = getStoredVaultConfig();
  if (config && config.vaultPath) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/setup" replace />;
};

function App() {
  const location = useLocation();
  const showLaser = location.pathname === "/prompt";
  const [horizontalBeamOffset, setHorizontalBeamOffset] = useState(0.11);
  const [verticalBeamOffset, setVerticalBeamOffset] = useState(0.06);

  const [backendStatus, setBackendStatus] = useState<"checking" | "downloading" | "ready" | "error">("checking");
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadMsg, setDownloadMsg] = useState<string>("Initializing...");

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;

    const initBackend = async () => {
      const isTauri = typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__ !== undefined;
      if (!isTauri) {
        if (active) setBackendStatus("ready");
        return;
      }

      try {
        const unlisten = await listen<{ progress: number; message: string }>(
          "backend-download-status",
          (event) => {
            if (!active) return;
            if (event.payload.progress === 100) {
              setBackendStatus("ready");
            } else if (event.payload.progress === 0 && event.payload.message.startsWith("Error")) {
              setBackendStatus("error");
              setDownloadMsg(event.payload.message);
            } else {
              setBackendStatus("downloading");
              setDownloadProgress(event.payload.progress);
              setDownloadMsg(event.payload.message);
            }
          }
        );
        unlistenFn = unlisten;

        const res = await invoke<any>("check_and_start_backend");
        if (!active) return;
        if (res.status === "ready") {
          setBackendStatus("ready");
        } else if (res.status === "downloading") {
          setBackendStatus("downloading");
        }
      } catch (err) {
        console.warn("Tauri context error:", err);
        if (active) setBackendStatus("ready");
      }
    };

    initBackend();

    return () => {
      active = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const canvasWidth = W * 0.85;

      const el = document.getElementById("prompt-input-card");
      if (!el) {
        // Fallback positioning if DOM is not ready
        const promptBoxWidth = Math.min(W * 0.65, 896);
        const rightCornerX = promptBoxWidth / 2;
        const beamTipFromCenter = 54.5 * (H / 204.8);
        setHorizontalBeamOffset((rightCornerX - beamTipFromCenter) / canvasWidth);
        setVerticalBeamOffset(80 / H);
        return;
      }

      const rect = el.getBoundingClientRect();
      // Sit 4px above the input box top border
      const verticalOffset = ((H / 2) - (rect.top - 4)) / H;
      // Calculate horizontal target using original shift: right edge minus the beam tip width
      const beamTipFromCenter = 54.5 * (H / 204.8);
      const horizontalOffset = ((rect.right - (W / 2)) - beamTipFromCenter) / canvasWidth;

      setHorizontalBeamOffset(horizontalOffset);
      setVerticalBeamOffset(verticalOffset);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    // Watch for size/content shifts in the DOM (e.g. preview list opening) to update laser position
    const observer = new MutationObserver(handleResize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [location.pathname]);

  if (backendStatus === "checking" || backendStatus === "downloading" || backendStatus === "error") {
    return (
      <div className="fixed inset-0 min-h-screen w-full bg-[#030303] flex flex-col items-center justify-center py-12 px-6 select-none z-50 text-white font-sans">
        <div 
          className="w-full max-w-md bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] p-8 flex flex-col gap-6 items-center text-center shadow-2xl relative overflow-hidden"
          style={{
            backgroundImage: "radial-gradient(circle 350px at 50% 50%, rgba(160, 84, 141, 0.16) 0%, transparent 80%)"
          }}
        >
          <div className="p-3.5 rounded-full bg-[#A0548D]/15 text-[#e98bd7] border border-[#A0548D]/25 animate-pulse">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-slate-100">Setting up VaultAgent</h2>
          <p className="text-xs text-white/50 leading-relaxed max-w-sm">
            {backendStatus === "error" 
              ? "We ran into an issue downloading the backend server component. Please check your internet connection."
              : "Downloading core reasoning models and indexers to local system. This only happens on the first launch."
            }
          </p>

          {backendStatus !== "error" ? (
            <div className="w-full flex flex-col gap-2 mt-4">
              <div className="flex justify-between text-[10px] text-white/40 font-mono">
                <span>{downloadMsg}</span>
                <span>{downloadProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 border border-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#A0548D] to-[#e98bd7] transition-all duration-300 rounded-full"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="w-full flex flex-col gap-3 mt-4">
              <div className="text-[10px] text-red-400 font-mono p-3 bg-red-950/20 border border-red-500/20 rounded-xl break-all">
                {downloadMsg}
              </div>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-2 bg-[#A0548D] hover:bg-[#884377] text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Retry Setup
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="h-screen flex justify-center items-center relative overflow-hidden">
      <BlobBackground />

      {/* Eager-loaded LaserFlow — always mounted, WebGL context stays warm. */}
      <div
        className="absolute inset-0 z-0 flex justify-center items-center"
        style={{
          opacity: showLaser ? 1 : 0,
          transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          pointerEvents: showLaser ? 'auto' : 'none',
        }}
      >
        <div className="w-[85vw] h-screen">
          <LaserFlow
            horizontalBeamOffset={horizontalBeamOffset - 0.01}
            verticalBeamOffset={verticalBeamOffset - 0.01}
            color="#A0548D"
            wispDensity={1.2}
            wispIntensity={1}
            fogIntensity={0.45}
            mouseTiltStrength={0.05}
          />
        </div>
      </div>

      {/* Routing content area */}
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/setup" element={<Setuppage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/discovery" element={<DiscoveryPage />} />
        <Route path="/prompt" element={<PromptPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>

      <PillNav
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Discovery", href: "/discovery" },
          { label: "Prompt", href: "/prompt" },
          { label: "Chats", href: "/chats" },
          { label: "Settings", href: "/settings" },
        ]}
        activeHref={location.pathname}
        className="custom-nav"
        ease="power2.easeOut"
        baseColor="#A0548D"
        pillColor="transparent"
        hoveredPillTextColor="#ffffff"
        pillTextColor="#FFFFE8"
        initialLoadAnimation
      />
    </main>
  );
}

export default App;
