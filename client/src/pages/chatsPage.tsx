import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Search,
  Sparkles,
  FileText,
  Clock,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import {
  fetchHistorySessions,
  SessionHistoryItem,
} from "../lib/api";
import { LiveProcessReview } from "../components/LiveProcessReview";

export const ChatsPage: React.FC = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [reopenSessionId, setReopenSessionId] = useState<string | null>(null);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const data = await fetchHistorySessions(50, 0);
      setSessions(data.sessions || []);
    } catch (err) {
      console.error("Failed to load generation history:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const filteredSessions = sessions.filter((s) =>
    s.prompt.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-[#FFFFE8] tracking-tight flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-[#A0548D]" />
              Generation History & Past Sessions
            </h1>
            <p className="text-xs text-[#FFFFE8]/60 mt-0.5">
              Review past research runs, raw note conversions, and synthesized vault notes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 absolute left-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search history by prompt..."
                className="bg-white/5 border border-white/10 rounded-xl py-1.5 pl-9 pr-4 text-xs text-[#FFFFE8] placeholder-white/40 focus:outline-none focus:border-[#A0548D] w-56 transition-all focus:w-64 font-sans"
              />
            </div>

            <button
              onClick={loadHistory}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#A0548D]" : ""}`} />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-3">
              <RefreshCw className="w-8 h-8 text-[#A0548D] animate-spin" />
              <p className="text-xs text-white/50">Loading generation history...</p>
            </div>
          ) : filteredSessions.length === 0 ? (
            /* Explicit Empty History State (FR-11.4) */
            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-white/30">
                <MessageSquare className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">No Generation History Yet</h3>
                <p className="text-xs text-white/50 max-w-sm">
                  You haven't run any research or raw note conversion sessions yet. Head over to the Prompt agent to get started!
                </p>
              </div>
              <button
                onClick={() => navigate("/prompt")}
                className="flex items-center gap-2 px-4 py-2 bg-[#A0548D] hover:bg-[#884377] text-white text-xs font-semibold rounded-xl shadow-lg transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> Go to Prompt Agent <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSessions.map((session) => (
                <motion.div
                  key={session.session_id}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setReopenSessionId(session.session_id)}
                  className="p-5 bg-white/5 rounded-2xl border border-white/10 hover:border-[#A0548D]/50 hover:bg-white/10 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-white/40">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" /> {session.created_at?.slice(0, 10)}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#A0548D]/20 text-[#FFFFE8] uppercase text-[10px] font-semibold border border-[#A0548D]/30">
                        {session.mode}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white group-hover:text-[#FFFFE8] line-clamp-2 leading-snug">
                      "{session.prompt}"
                    </h3>
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/60 border-t border-white/5 pt-3">
                    <span className="flex items-center gap-1 text-[11px]">
                      <FileText className="w-3.5 h-3.5 text-[#A0548D]" /> {session.output_files_count} notes
                    </span>
                    <span className="text-[11px] text-[#A0548D] font-medium group-hover:translate-x-1 transition-transform flex items-center gap-1">
                      Reopen Session <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Reopen Session Review Modal */}
      {reopenSessionId && (
        <LiveProcessReview
          sessionId={reopenSessionId}
          onClose={() => setReopenSessionId(null)}
          onSaved={() => {
            setReopenSessionId(null);
            navigate("/discovery");
          }}
        />
      )}
    </div>
  );
};
