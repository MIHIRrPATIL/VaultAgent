import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  FileText,
  Save,
  Trash2,
  X,
  Search,
  Cpu,
  PenTool,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Wand2,
  Send,
  BookOpen,
  Code2,
  Info,
  Clock,
  Tag,
  Command,
  GitBranch,
  FileCode,
  Link as LinkIcon,
} from "lucide-react";
import {
  getApiBaseUrl,
  commitPipelineSession,
  discardPipelineSession,
  StagedFile,
  PipelineProgressEvent,
  updateStagedFile,
  refineStagedFile,
  fetchPipelineSession,
} from "../lib/api";

interface LiveProcessReviewProps {
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}

const formatErrorMessage = (rawError: string): string => {
  if (!rawError) return "An unknown error occurred during execution.";
  
  const lower = rawError.toLowerCase();
  
  if (lower.includes("task is not json serializable")) {
    return "Internal Server Error: A task serialization issue occurred. The background execution finished, but couldn't save session state. Please check your vault or retry.";
  }
  
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "Rate Limit Exceeded: The AI provider throttled the request (HTTP 429). Please wait a moment and try again, or check your API key usage limits.";
  }
  
  if (lower.includes("payment required") || lower.includes("402")) {
    return "Insufficient Credits: The API key has run out of credits or has insufficient funds to make this call. Please top up your provider balance.";
  }
  
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key")) {
    return "Authentication Failed: The API key provided is invalid or has expired. Please update it in the Settings panel.";
  }
  
  if (lower.includes("connection error") || lower.includes("failed to establish") || lower.includes("timeout")) {
    return "Network Timeout: The connection to the AI provider timed out or failed. Please check your internet connection and try again.";
  }
  
  let cleanMsg = rawError;
  if (cleanMsg.startsWith("Pipeline failed: ")) {
    cleanMsg = cleanMsg.substring("Pipeline failed: ".length);
  }
  return cleanMsg;
};

const renderMarkdown = (content: string): React.ReactNode => {
  if (!content) return null;
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let listItems: string[] = [];

  const renderedElements: React.ReactNode[] = [];
  let keyIdx = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      const itemsToRender = [...listItems];
      renderedElements.push(
        <ul key={`list-${keyIdx++}`} className="list-disc pl-5 my-3 space-y-1 text-white/90">
          {itemsToRender.map((item, idx) => (
            <li key={idx}>{parseInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const parseInline = (text: string): React.ReactNode[] => {
    if (!text) return [];
    const inlineRegex = /(\*\*.*?\*\*|`.*?`|\[\[.*?\]\])/g;
    const splitParts = text.split(inlineRegex);

    return splitParts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={pIdx} className="font-bold text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={pIdx} className="bg-black/40 px-1.5 py-0.5 rounded font-mono text-[#e98bd7] text-xs">{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const linkContent = part.slice(2, -2);
        const [target, alias] = linkContent.split('|');
        const displayText = alias || target;
        return (
          <span
            key={pIdx}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#A0548D]/15 border border-[#A0548D]/30 text-[#e98bd7] font-medium cursor-default select-all"
            title={`Wiki-link: ${target}`}
          >
            🔗 {displayText}
          </span>
        );
      }
      return part;
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const linesToRender = [...codeLines];
        renderedElements.push(
          <pre key={`code-${keyIdx++}`} className="bg-black/50 p-4 rounded-xl border border-white/10 font-mono text-emerald-400 overflow-x-auto text-xs my-3 select-all">
            <code>{linesToRender.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('#')) {
      flushList();
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const headingText = match[2];
        const classes = 
          level === 1 ? "text-xl font-bold text-white border-b border-white/10 pb-2 mt-5 mb-3" :
          level === 2 ? "text-lg font-bold text-white mt-4 mb-2" :
          level === 3 ? "text-base font-semibold text-white/90 mt-3 mb-2" :
          "text-sm font-semibold text-white/80 mt-2 mb-1";
        
        renderedElements.push(
          <div key={`h-${keyIdx++}`} className={classes}>
            {parseInline(headingText)}
          </div>
        );
        continue;
      }
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2));
      continue;
    }

    if (line.startsWith('>')) {
      flushList();
      let quoteText = line.slice(1).trim();
      
      const calloutMatch = quoteText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|ABSTRACT)\]/i);
      if (calloutMatch) {
        const type = calloutMatch[1].toUpperCase();
        const calloutLines = [];
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('>')) {
          calloutLines.push(lines[j].slice(1).trim());
          j++;
        }
        i = j - 1;

        const bgClass = 
          type === "NOTE" || type === "INFO" ? "bg-blue-500/10 border-blue-500/30 text-blue-300" :
          type === "TIP" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
          type === "IMPORTANT" || type === "WARNING" ? "bg-amber-500/10 border-amber-500/30 text-amber-300" :
          type === "CAUTION" ? "bg-red-500/10 border-red-500/30 text-red-300" :
          "bg-[#A0548D]/10 border-[#A0548D]/30 text-[#e98bd7]";
        
        renderedElements.push(
          <div key={`callout-${keyIdx++}`} className={`p-4 rounded-xl border ${bgClass} my-3 space-y-1`}>
            <div className="font-bold text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <span>💡</span> {type}
            </div>
            <div className="text-xs opacity-90 leading-relaxed">
              {calloutLines.length > 0 ? (
                calloutLines.map((l, lIdx) => <div key={lIdx}>{parseInline(l)}</div>)
              ) : (
                <span>Empty callout content</span>
              )}
            </div>
          </div>
        );
      } else {
        renderedElements.push(
          <blockquote key={`quote-${keyIdx++}`} className="border-l-4 border-[#A0548D]/40 pl-4 py-1 italic my-3 text-white/70">
            {parseInline(quoteText)}
          </blockquote>
        );
      }
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    renderedElements.push(
      <p key={`p-${keyIdx++}`} className="text-white/80 my-2 leading-relaxed">
        {parseInline(line)}
      </p>
    );
  }

  flushList();
  return <div className="space-y-2 select-text">{renderedElements}</div>;
};

export const LiveProcessReview: React.FC<LiveProcessReviewProps> = ({
  sessionId,
  onClose,
  onSaved,
}) => {
  // Stepper & Stream State
  const [stage, setStage] = useState<string>("indexer");
  const [progress, setProgress] = useState<number>(5);
  const [statusMessage, setStatusMessage] = useState<string>("Initializing agent pipeline...");
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Staged Files & Review State
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // Inline editing and AI refinement states
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedContent, setEditedContent] = useState<string>("");
  const [editedFilename, setEditedFilename] = useState<string>("");
  const [refinePrompt, setRefinePrompt] = useState<string>("");
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [refineUrls, setRefineUrls] = useState<string[]>([]);
  const [newUrlInput, setNewUrlInput] = useState<string>("");
  const [showUrlPanel, setShowUrlPanel] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"reader" | "editor" | "metadata" | "sources">("reader");
  const [researchOutput, setResearchOutput] = useState<any>(null);
  const [expandedSourceIndex, setExpandedSourceIndex] = useState<number | null>(null);

  // Sync edits when active file changes
  useEffect(() => {
    if (stagedFiles[selectedFileIndex]) {
      setIsEditing(false);
      setEditedContent(stagedFiles[selectedFileIndex].content);
      setEditedFilename(stagedFiles[selectedFileIndex].filename);
      setRefinePrompt("");
      setActiveTab("reader");
      setRefineUrls([]);
      setNewUrlInput("");
      setShowUrlPanel(false);
      setExpandedSourceIndex(null);
    }
  }, [selectedFileIndex, stagedFiles]);

  const handleSaveEdits = async () => {
    const activeFile = stagedFiles[selectedFileIndex];
    if (!activeFile) return;
    try {
      await updateStagedFile(sessionId, activeFile.id, editedContent, editedFilename);
      setStagedFiles(prev => prev.map(f => {
        if (f.id === activeFile.id) {
          return {
            ...f,
            content: editedContent,
            filename: editedFilename,
            rel_path: f.rel_path.replace(f.filename, editedFilename),
            full_target_path: f.full_target_path.replace(f.filename, editedFilename)
          };
        }
        return f;
      }));
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to update staged file:", err);
      alert("Failed to save your edits to the server.");
    }
  };

  const handleRefineWithAI = async () => {
    const activeFile = stagedFiles[selectedFileIndex];
    if (!activeFile || !refinePrompt.trim()) return;
    setIsRefining(true);
    try {
      const stored = localStorage.getItem("vault_agent_config");
      let geminiKey = "";
      let openrouterKey = "";
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          geminiKey = parsed.geminiKey || "";
          openrouterKey = parsed.openrouterKey || "";
        } catch (e) {}
      }

      const updatedFile = await refineStagedFile(
        sessionId,
        activeFile.id,
        refinePrompt,
        refineUrls.length > 0 ? refineUrls : undefined,
        geminiKey,
        openrouterKey
      );
      setStagedFiles(prev => prev.map(f => {
        if (f.id === activeFile.id) {
          return {
            ...f,
            content: updatedFile.content,
            frontmatter: updatedFile.frontmatter
          };
        }
        return f;
      }));
      setRefinePrompt("");
      setRefineUrls([]);
      setShowUrlPanel(false);
    } catch (err: any) {
      console.error("Failed to refine file with AI:", err);
      alert(err.message || "Failed to refine note with AI.");
    } finally {
      setIsRefining(false);
    }
  };

  // Connect SSE EventSource
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isActive = true;

    const connectStream = async () => {
      // First, try to fetch current session details
      try {
        const sessionData = await fetchPipelineSession(sessionId);
        if (sessionData && isActive) {
          if (sessionData.staged_files && sessionData.staged_files.length > 0) {
            setStagedFiles(sessionData.staged_files);
          }
          if (sessionData.research_output) {
            setResearchOutput(sessionData.research_output);
          }
          if (sessionData.status === "staged" || sessionData.status === "completed") {
            setIsCompleted(true);
            setProgress(100);
            setStage("writer");
            setStatusMessage("Loaded staged notes from session.");
            return;
          }
        }
      } catch (err) {
        console.warn("Failed to pre-fetch session data:", err);
      }

      try {
        const baseUrl = await getApiBaseUrl();
        eventSource = new EventSource(`${baseUrl}/pipeline/stream/${sessionId}`);

        eventSource.onmessage = (event) => {
          try {
            const payload: PipelineProgressEvent = JSON.parse(event.data);
            setStage(payload.stage);
            setProgress(payload.progress_percent);
            setStatusMessage(payload.message);

            if (payload.event_type === "pipeline_complete") {
              setIsCompleted(true);
              if (payload.data?.staged_files) {
                setStagedFiles(payload.data.staged_files);
              }
              if (payload.data?.research_output) {
                setResearchOutput(payload.data.research_output);
              }
              eventSource?.close();
            } else if (payload.event_type === "error") {
              setError(formatErrorMessage(payload.message));
              eventSource?.close();
            }
          } catch (e) {
            console.error("Error parsing SSE event:", e);
          }
        };

        eventSource.onerror = (err) => {
          console.warn("SSE connection error:", err);
          setError("Pipeline connection lost. The session has expired or the server restarted.");
          eventSource?.close();
        };
      } catch (err) {
        console.error("Failed to setup SSE stream:", err);
      }
    };

    connectStream();

    return () => {
      isActive = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [sessionId]);

  const handleSaveToVault = async () => {
    setIsSaving(true);
    try {
      await commitPipelineSession(sessionId);
      onSaved();
    } catch (err) {
      console.error("Failed to commit session:", err);
      alert("Failed to commit notes to vault.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = async () => {
    try {
      await discardPipelineSession(sessionId);
    } catch (err) {
      console.error("Error discarding session:", err);
    }
    onClose();
  };

  const stagesList = [
    { id: "indexer", label: "Vault Indexer", icon: Activity },
    { id: "discovery", label: "Web Discovery", icon: Search },
    { id: "linker", label: "Linker & Synthesis", icon: Cpu },
    { id: "writer", label: "Writer Staging", icon: PenTool },
  ];

  const activeFile = stagedFiles[selectedFileIndex];

  if (isCompleted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-end py-6 pl-6 pr-0 bg-black/20 backdrop-blur-sm font-sans select-none pointer-events-none">
        <motion.div
          initial={{ x: "110%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "110%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 180 }}
          className="w-[50vw] min-w-[720px] h-[70vh] bg-[#121216]/85 backdrop-blur-2xl border-l border-y border-white/10 rounded-l-[32px] flex flex-col overflow-hidden text-[#FFFFE8] shadow-2xl pointer-events-auto"
        >
          {/* Header */}
          <header className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#A0548D]/20 border border-[#A0548D]/40 text-[#A0548D]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  Generated Notes Review
                </h2>
                <p className="text-xs text-[#FFFFE8]/60">
                  {stagedFiles.length} notes staged for review before committing to vault
                </p>
              </div>
            </div>

            <button
              onClick={handleDiscard}
              className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          {/* Generated File Review Interface */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Sidebar Staged Files List */}
            <aside className="w-64 border-r border-white/10 bg-black/20 p-4 flex flex-col gap-3 shrink-0 overflow-y-auto">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50 pb-2 border-b border-white/10 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#A0548D]" /> Staged Files ({stagedFiles.length})
              </div>
              <div className="space-y-1.5 flex-1">
                {stagedFiles.map((file, idx) => {
                  const isSelected = idx === selectedFileIndex;
                  return (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFileIndex(idx)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex flex-col gap-1 ${
                        isSelected
                          ? "bg-[#A0548D]/30 border-[#A0548D] text-white font-medium"
                          : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText className={`w-3.5 h-3.5 ${isSelected ? "text-[#A0548D]" : "text-white/40"}`} />
                        <span className="truncate">{file.filename}</span>
                      </div>
                      {file.has_collision && (
                        <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30 w-fit">
                          Collision (disambiguated)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* Main Preview Panel */}
            <main className="flex-1 flex flex-col min-w-0 bg-[#07090e]/60 overflow-hidden">
              {activeFile ? (
                <>
                  {/* File Metadata Header & Tab Switcher */}
                  <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/5 backdrop-blur-md">
                    {isEditing ? (
                      <div className="flex flex-col gap-1 w-full max-w-sm">
                        <input
                          type="text"
                          value={editedFilename}
                          onChange={(e) => setEditedFilename(e.target.value)}
                          className="bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#A0548D] font-mono"
                          placeholder="Filename (e.g. recursion.md)"
                        />
                        <p className="text-[10px] text-white/40 font-mono">Editing filename & content</p>
                      </div>
                    ) : (
                      <div className="flex flex-col min-w-0">
                        <h4 className="text-sm font-semibold text-white flex items-center gap-2 truncate">
                          <FileCode className="w-4 h-4 text-[#e98bd7] shrink-0" /> <span className="truncate">{activeFile.filename}</span>
                        </h4>
                        <p className="text-[10px] text-white/40 font-mono mt-0.5 truncate">{activeFile.rel_path}</p>
                      </div>
                    )}

                    {/* Tab Navigation */}
                    {!isEditing && (
                      <div className="flex items-center bg-black/40 border border-white/10 rounded-xl p-0.5 ml-4">
                        <button
                          onClick={() => setActiveTab("reader")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "reader"
                              ? "bg-[#A0548D]/20 text-[#e98bd7] border border-[#A0548D]/30"
                              : "text-white/60 hover:text-white border border-transparent"
                          }`}
                        >
                          <BookOpen className="w-3.5 h-3.5" /> Reader
                        </button>
                        <button
                          onClick={() => setActiveTab("editor")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "editor"
                              ? "bg-[#A0548D]/20 text-[#e98bd7] border border-[#A0548D]/30"
                              : "text-white/60 hover:text-white border border-transparent"
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" /> Raw MD
                        </button>
                        <button
                          onClick={() => setActiveTab("metadata")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "metadata"
                              ? "bg-[#A0548D]/20 text-[#e98bd7] border border-[#A0548D]/30"
                              : "text-white/60 hover:text-white border border-transparent"
                          }`}
                        >
                          <Info className="w-3.5 h-3.5" /> Metadata
                        </button>
                        <button
                          onClick={() => setActiveTab("sources")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            activeTab === "sources"
                              ? "bg-[#A0548D]/20 text-[#e98bd7] border border-[#A0548D]/30"
                              : "text-white/60 hover:text-white border border-transparent"
                          }`}
                        >
                          <Search className="w-3.5 h-3.5" /> Sources
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={handleSaveEdits}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-[11px] font-semibold text-white rounded-lg transition-all cursor-pointer shadow-md"
                          >
                            Save Edits
                          </button>
                          <button
                            onClick={() => {
                              setIsEditing(false);
                              setEditedContent(activeFile.content);
                              setEditedFilename(activeFile.filename);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[11px] text-white/80 rounded-lg transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setIsEditing(true);
                            setEditedContent(activeFile.content);
                            setEditedFilename(activeFile.filename);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#A0548D]/20 hover:bg-[#A0548D]/30 border border-[#A0548D]/40 text-[#e98bd7] text-[11px] font-semibold rounded-lg transition-all cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Edit Note
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Document Body Viewports */}
                  {isEditing ? (
                    <div className="flex-1 flex flex-col p-6 min-h-0">
                      <textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="flex-1 w-full bg-black/30 border border-white/10 rounded-xl p-4 font-mono text-xs text-white/95 focus:outline-none focus:border-[#A0548D] resize-none leading-relaxed select-text"
                        placeholder="Type note content in Markdown format..."
                      />
                    </div>
                  ) : activeTab === "reader" ? (
                    <div className="flex-1 p-6 overflow-y-auto font-sans text-xs leading-relaxed select-text space-y-5 bg-[#0b0f19]/35">
                      {/* Render YAML Frontmatter Properties inside Reader */}
                      {activeFile.frontmatter && Object.keys(activeFile.frontmatter).length > 0 && (
                        <div className="flex flex-wrap gap-2 pb-4 border-b border-white/5">
                          {Object.entries(activeFile.frontmatter).map(([k, v]) => (
                            <div
                              key={k}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-white/80"
                            >
                              <span className="text-white/40">{k}:</span>
                              <span className="text-[#e98bd7] font-semibold">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Rendered Markdown Body Content */}
                      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 font-sans text-sm leading-relaxed text-slate-200 overflow-x-hidden shadow-inner">
                        {renderMarkdown(activeFile.content)}
                      </div>
                    </div>
                  ) : activeTab === "editor" ? (
                    <div className="flex-1 p-6 overflow-y-auto font-mono text-xs leading-relaxed text-slate-300 bg-[#07090e]/90 border border-white/5 rounded-2xl my-4 mx-6 select-text space-y-1 shadow-inner">
                      {activeFile.content.split("\n").map((line, idx) => (
                        <div key={idx} className="flex gap-4">
                          <span className="text-white/20 select-none text-right w-8">{idx + 1}</span>
                          <span className="whitespace-pre-wrap">{line}</span>
                        </div>
                      ))}
                    </div>
                  ) : activeTab === "metadata" ? (
                    /* Metadata Connections Tab */
                    <div className="flex-1 p-6 overflow-y-auto font-sans text-xs bg-[#0b0f19]/35 space-y-6">
                      {/* Document Statistics Panel */}
                      <div className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#e98bd7]" /> Reading Metrics
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col">
                            <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Word Count</span>
                            <span className="text-base font-bold text-white mt-1">
                              {activeFile.content.split(/\s+/).filter(Boolean).length}
                            </span>
                          </div>
                          <div className="bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col">
                            <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Estimated Read</span>
                            <span className="text-base font-bold text-white mt-1">
                              {Math.max(1, Math.round(activeFile.content.split(/\s+/).length / 200))} min
                            </span>
                          </div>
                          <div className="bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col">
                            <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Characters</span>
                            <span className="text-base font-bold text-white mt-1">
                              {activeFile.content.length}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Frontmatter Attributes Grid */}
                      {activeFile.frontmatter && Object.keys(activeFile.frontmatter).length > 0 && (
                        <div className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                            <Tag className="w-3.5 h-3.5 text-[#e98bd7]" /> Frontmatter Properties
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {Object.entries(activeFile.frontmatter).map(([k, v]) => (
                                <div key={k} className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                                  <span className="text-[9px] text-white/40 font-mono uppercase tracking-wider">{k}</span>
                                  <span className="text-xs text-white/95 font-medium truncate">{JSON.stringify(v)}</span>
                                </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Extracted Outbound Linkages */}
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-white/60 flex items-center gap-1.5">
                          <GitBranch className="w-3.5 h-3.5 text-[#e98bd7]" /> Vault Linkages
                        </div>
                        {(() => {
                          const matches = activeFile.content.match(/\[\[(.*?)\]\]/g) || [];
                          const extractedLinks = Array.from(new Set(matches.map((m) => {
                            const linkVal = m.slice(2, -2);
                            const [target, alias] = linkVal.split("|");
                            return { target, alias: alias || null };
                          })));

                          return extractedLinks.length > 0 ? (
                            <div className="grid grid-cols-1 gap-2">
                              {extractedLinks.map((link, idx) => (
                                <div key={idx} className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="px-1.5 py-0.5 rounded bg-[#A0548D]/25 border border-[#A0548D]/30 text-[#e98bd7] text-[9px] font-mono font-semibold uppercase tracking-wider">
                                      outbound
                                    </span>
                                    <span className="text-xs font-medium text-white/90 truncate max-w-xs">{link.target}</span>
                                    {link.alias && (
                                      <span className="text-[10px] text-white/40">
                                        (alias: {link.alias})
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[9px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20 font-medium">
                                    resolved
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-white/30 italic pl-1">No wiki-link tags present in this note.</p>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    /* Web Research Sources Tab */
                    <div className="flex-1 p-6 overflow-y-auto font-sans text-xs bg-[#0b0f19]/35 space-y-6">
                      {!researchOutput ? (
                        <div className="flex flex-col items-center justify-center p-8 text-center bg-white/5 border border-white/5 rounded-2xl gap-3">
                          <Search className="w-8 h-8 text-white/30" />
                          <div className="text-xs font-semibold text-white/70">No Web Research Recorded</div>
                          <p className="text-[11px] text-white/40 max-w-sm leading-relaxed">
                            No web research was logged for this session. This happens when the pipeline runs in raw Note Conversion mode, or no search results were generated.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Search Header Info */}
                          <div className="bg-white/5 border border-white/5 p-4 rounded-2xl flex flex-col gap-1">
                            <div className="text-[10px] uppercase font-mono tracking-wider text-white/45">Research Topic Queried</div>
                            <h3 className="text-sm font-semibold text-white mt-1">{researchOutput.topic || "N/A"}</h3>
                            <div className="flex items-center gap-4 mt-2 text-[10px] text-white/45">
                              <span>Attempted Sites: <strong className="text-[#e98bd7]">{researchOutput.sources_attempted || 0}</strong></span>
                              <span>•</span>
                              <span>Successfully Crawled: <strong className="text-emerald-400">{researchOutput.sources_succeeded || 0}</strong></span>
                            </div>
                          </div>

                          {/* Sources list */}
                          <div className="space-y-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-white/60">Crawled Sources</div>
                            <div className="flex flex-col gap-2">
                              {researchOutput.sources && researchOutput.sources.length > 0 ? (
                                researchOutput.sources.map((source: any, sIdx: number) => {
                                  const isExpanded = expandedSourceIndex === sIdx;
                                  return (
                                    <div key={sIdx} className="bg-white/5 border border-white/5 rounded-xl overflow-hidden">
                                      <div
                                        onClick={() => setExpandedSourceIndex(isExpanded ? null : sIdx)}
                                        className="p-3 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer transition-colors"
                                      >
                                        <div className="flex items-center gap-2 min-w-0 pr-4">
                                          {source.success ? (
                                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-mono font-semibold uppercase">
                                              success
                                            </span>
                                          ) : (
                                            <span className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-mono font-semibold uppercase">
                                              failed
                                            </span>
                                          )}
                                          <a
                                            href={source.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-xs font-medium text-white/80 hover:text-[#e98bd7] truncate hover:underline"
                                          >
                                            {source.title || source.url}
                                          </a>
                                        </div>
                                        <span className="text-[10px] text-white/40 shrink-0 font-mono">
                                          {isExpanded ? "Collapse ▲" : "View text ▼"}
                                        </span>
                                      </div>

                                      {isExpanded && (
                                        <div className="p-3 bg-black/40 border-t border-white/5 text-[11px] text-white/70 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar select-text leading-relaxed">
                                          {source.markdown_content || source.error_message || "No scraped content available."}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-xs text-white/30 italic pl-1">No reference sources list is stored.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI Refinement Copilot Console */}
                  {!isEditing && (
                    <div className="p-4 border-t border-white/10 bg-black/30 flex flex-col gap-3 shrink-0">
                      {/* Command suggestions segment */}
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[9px] uppercase font-mono tracking-wider text-white/45 flex items-center gap-1">
                            <Command className="w-3 h-3 text-[#e98bd7]" /> Quick Tweaks:
                          </span>
                          {[
                            "Make it more technical",
                            "Add complexity analysis",
                            "Summarize into TL;DR",
                            "Standardize headers",
                          ].map((suggestion) => (
                            <button
                              key={suggestion}
                              onClick={() => setRefinePrompt(suggestion)}
                              className="px-2.5 py-1 bg-white/5 hover:bg-[#A0548D]/20 border border-white/5 hover:border-[#A0548D]/30 text-white/70 hover:text-[#e98bd7] text-[10px] rounded-full transition-all cursor-pointer select-none"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>

                        {/* Toggle Reference URLs Link */}
                        <button
                          onClick={() => setShowUrlPanel(!showUrlPanel)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                            showUrlPanel || refineUrls.length > 0
                              ? "bg-[#A0548D]/20 text-[#e98bd7] border border-[#A0548D]/30"
                              : "bg-white/5 border border-white/5 text-white/60 hover:text-white"
                          }`}
                        >
                          <LinkIcon className="w-3 h-3" /> References ({refineUrls.length})
                        </button>
                      </div>

                      {/* Reference URLs Panel */}
                      {showUrlPanel && (
                        <div className="flex flex-col gap-2 p-3 bg-black/40 border border-white/5 rounded-xl animate-in fade-in duration-250">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newUrlInput}
                              onChange={(e) => setNewUrlInput(e.target.value)}
                              placeholder="Paste a reference URL (e.g. https://react.dev) and press Enter..."
                              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[#A0548D]"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (newUrlInput.trim()) {
                                    if (!refineUrls.includes(newUrlInput.trim())) {
                                      setRefineUrls([...refineUrls, newUrlInput.trim()]);
                                    }
                                    setNewUrlInput("");
                                  }
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (newUrlInput.trim()) {
                                  if (!refineUrls.includes(newUrlInput.trim())) {
                                    setRefineUrls([...refineUrls, newUrlInput.trim()]);
                                  }
                                  setNewUrlInput("");
                                }
                              }}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold rounded-lg transition-all cursor-pointer"
                            >
                              Add
                            </button>
                          </div>

                          {/* Added URLs list */}
                          {refineUrls.length > 0 && (
                            <div className="flex flex-col gap-1.5 mt-1 max-h-24 overflow-y-auto custom-scrollbar pr-1">
                              {refineUrls.map((url, uIdx) => (
                                <div key={uIdx} className="flex items-center justify-between bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg text-[10px] text-white/80">
                                  <span className="truncate max-w-[90%] font-mono">{url}</span>
                                  <button
                                    onClick={() => setRefineUrls(refineUrls.filter((_, i) => i !== uIdx))}
                                    className="p-0.5 text-white/40 hover:text-red-400 cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex gap-3 items-center">
                        <div className="p-2 rounded-xl bg-[#A0548D]/15 text-[#e98bd7] border border-[#A0548D]/25">
                          <Wand2 className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={refinePrompt}
                          onChange={(e) => setRefinePrompt(e.target.value)}
                          disabled={isRefining}
                          placeholder={
                            refineUrls.length > 0
                              ? `Instruct AI to refine this note using ${refineUrls.length} web reference(s)...`
                              : "Instruct AI to refine this note (e.g. 'Add a section explaining worst-case complexity')..."
                          }
                          className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-white/45 focus:outline-none focus:border-[#A0548D] disabled:opacity-50 font-sans"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !isRefining) handleRefineWithAI();
                          }}
                        />
                        <button
                          onClick={handleRefineWithAI}
                          disabled={isRefining || !refinePrompt.trim()}
                          className="px-4 py-2.5 bg-[#A0548D] hover:bg-[#884377] disabled:bg-white/5 disabled:text-white/20 disabled:border-transparent text-white text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                        >
                          {isRefining ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Refining...
                            </>
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5" /> Refine
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-white/40 italic">
                  Select a generated note from the left sidebar to preview.
                </div>
              )}
            </main>
          </div>

          {/* Footer Actions */}
          <footer className="px-6 py-4 border-t border-white/10 bg-black/30 flex items-center justify-between shrink-0">
            <button
              onClick={handleDiscard}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-xs font-semibold text-white/80 hover:text-red-400 rounded-xl transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> Discard
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveToVault}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-[#A0548D] hover:bg-[#884377] text-white text-xs font-semibold rounded-xl transition-all shadow-lg cursor-pointer"
              >
                {isSaving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save to Vault
              </button>
            </div>
          </footer>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end py-6 pl-6 pr-0 bg-transparent font-sans select-none pointer-events-none">
      <div className="flex items-center relative">
        {/* Detail Tray */}
        <AnimatePresence>
          {isExpanded && !error && (
            <motion.div
              initial={{ x: "100%", opacity: 0, width: 0 }}
              animate={{ x: 0, opacity: 1, width: 320 }}
              exit={{ x: "100%", opacity: 0, width: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 150 }}
              className="h-[340px] bg-[#121216]/85 backdrop-blur-2xl border-l border-y border-white/10 rounded-l-[24px] flex flex-col justify-between p-6 overflow-hidden pointer-events-auto text-left"
            >
              {/* Detailed Progress view */}
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#A0548D]">
                  {stagesList.find((s) => s.id === stage)?.label || "Executing"}
                </h4>
                <p className="text-[12.5px] text-[#FFFFE8]/80 leading-relaxed min-h-[90px] line-clamp-5">
                  {statusMessage}
                </p>
              </div>

              {/* Progress Bar & Cancel */}
              <div className="space-y-4">
                <div className="flex justify-between text-[10px] text-[#FFFFE8]/50 font-mono">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-white/5 border border-white/10 h-2 rounded-full overflow-hidden p-0.5">
                  <motion.div
                    className="bg-[#A0548D] h-full rounded-full shadow-[0_0_8px_rgba(160,84,141,0.6)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <button
                  onClick={handleDiscard}
                  className="w-full py-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-[11px] font-bold text-white/70 hover:text-red-400 rounded-lg transition-all cursor-pointer"
                >
                  Cancel Run
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Minimal Error View */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ x: "100%", opacity: 0, width: 0 }}
              animate={{ x: 0, opacity: 1, width: 320 }}
              exit={{ x: "100%", opacity: 0, width: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 150 }}
              className="h-[340px] bg-[#121216]/85 backdrop-blur-2xl border-l border-y border-white/10 rounded-l-[24px] flex flex-col justify-between p-6 overflow-hidden pointer-events-auto text-left"
            >
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                  Execution Failed
                </h4>
                <p className="text-[11.5px] text-red-300/80 leading-relaxed font-mono overflow-y-auto max-h-[220px] scrollbar-none">
                  {error}
                </p>
              </div>
              <button
                onClick={handleDiscard}
                className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-white rounded-lg transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mini-Dock (Stage Icon Panel) */}
        {!error && (
          <div className="w-[100px] h-[380px] bg-[#121216]/95 border-l border-y border-white/10 rounded-l-[24px] flex flex-col items-center justify-between py-6 shrink-0 pointer-events-auto shadow-xl relative z-10">
            {/* Toggle Expand Arrow Tab - Attached to the left edge side */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="absolute -left-[18px] top-1/2 -translate-y-1/2 w-[18px] h-16 bg-[#121216]/95 border-l border-y border-white/10 rounded-l-xl flex items-center justify-center text-white/50 hover:text-white transition-all cursor-pointer pointer-events-auto hover:bg-[#1a1a22] shadow-md z-20 group"
              title={isExpanded ? "Collapse Details" : "Expand Details"}
            >
              {isExpanded ? (
                <ChevronRight className="w-3.5 h-3.5 text-[#A0548D] group-hover:scale-110 transition-transform" />
              ) : (
                <ChevronLeft className="w-3.5 h-3.5 text-white/70 group-hover:scale-110 transition-transform" />
              )}
            </button>

            {/* Stage Icons */}
            <div className="flex flex-col gap-7 items-center my-auto">
              {stagesList.map((s, idx) => {
                const Icon = s.icon;
                const isCurrent = stage === s.id;
                const isPassed =
                  stagesList.findIndex((item) => item.id === stage) > idx;

                return (
                  <div
                    key={s.id}
                    title={s.label}
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all duration-300 relative group cursor-pointer ${
                      isPassed
                        ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                        : isCurrent
                        ? "bg-[#A0548D]/30 border-[#A0548D] text-white shadow-[0_0_15px_rgba(160,84,141,0.5)] animate-pulse"
                        : "bg-white/5 border-white/10 text-white/30"
                    }`}
                  >
                    {isPassed ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : (
                      <Icon className="w-6 h-6" />
                    )}
                    
                    {/* Tooltip on hover */}
                    <span className="absolute right-16 scale-0 group-hover:scale-100 transition-all duration-150 origin-right bg-black border border-white/10 text-[#FFFFE8] text-xs py-1.5 px-3 rounded-lg whitespace-nowrap shadow-xl">
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
