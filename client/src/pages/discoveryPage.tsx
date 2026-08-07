import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  RefreshCw,
  Folder,
  FolderOpen,
  FileText,
  Link as LinkIcon,
  Tag as TagIcon,
  List as ListIcon,
  ArrowDownLeft,
  ArrowUpRight,
  Activity,
  CheckCircle2,
  FolderPlus,
  FilePlus,
  Sparkles,
} from "lucide-react";

import {
  scanVault,
  fetchNeighbors,
  fetchOrphans,
  fetchAllNodes,
  readNodeContent,
  getStoredVaultConfig,
  saveVaultConfig,
  NodeItem,
  NeighborsResponse,
} from "../lib/api";

export const DiscoveryPage: React.FC = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  const [orphans, setOrphans] = useState<string[]>([]);
  const [selectedNodePath, setSelectedNodePath] = useState<string>("");
  const [neighbors, setNeighbors] = useState<NeighborsResponse | null>(null);
  const [noteContent, setNoteContent] = useState<string>("");

  const [viewMode, setViewMode] = useState<"content" | "graph" | "metadata">("content");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [totalLinks, setTotalLinks] = useState<number>(0);
  const [realFilesCount, setRealFilesCount] = useState<number>(0);
  const [activeVaultPath, setActiveVaultPath] = useState<string>("");

  // Mouse radial shine effect matching setupPage
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

  // Load vault index data and trigger initial scan if needed
  const loadData = async (force: boolean = false) => {
    setIsSyncing(true);
    try {
      let config = getStoredVaultConfig();
      if (!config || !config.vaultPath) {
        config = {
          vaultPath: "/home/mihir/Documents/Obsidian/DSA/DSA",
          excludedFolders: ["Templates", "Attachments", ".trash", ".obsidian"],
        };
        saveVaultConfig(config);
      }
      setActiveVaultPath(config.vaultPath);

      // Trigger indexer scan on backend
      const scanRes = await scanVault(config, force);
      if (scanRes.edges !== undefined) {
        setTotalLinks(scanRes.edges);
      }

      const [nodesRes, orphansRes] = await Promise.all([
        fetchAllNodes(),
        fetchOrphans(),
      ]);

      if (nodesRes.nodes) {
        setNodes(nodesRes.nodes);
        const real = nodesRes.nodes.filter((n) => n.is_existing_file === true);
        setRealFilesCount(real.length);


        if (real.length > 0) {
          setSelectedNodePath((prev) => (prev ? prev : real[0].path));
        } else if (nodesRes.nodes.length > 0) {
          setSelectedNodePath(nodesRes.nodes[0].path);
        }
      }

      if (orphansRes.orphans) {
        setOrphans(orphansRes.orphans);
      }
    } catch (err) {
      console.error("Error loading vault discovery data:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadData(false);
  }, []);

  // Browse folder and re-index
  const handlePickVaultAndIndex = async () => {
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      const selected = await dialog.open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        const config = { ...(getStoredVaultConfig() || {}), vaultPath: selected };
        saveVaultConfig(config as any);
        setActiveVaultPath(selected);
        await loadData(true);
      }
    } catch (err) {
      console.warn("Tauri dialog fallback:", err);
      const manual = prompt("Enter local vault directory path to scan:", activeVaultPath || "/home/mihir/Documents/Obsidian/DSA/DSA");
      if (manual) {
        const config = { ...(getStoredVaultConfig() || {}), vaultPath: manual };
        saveVaultConfig(config as any);
        setActiveVaultPath(manual);
        await loadData(true);
      }
    }
  };

  // Fetch node details when selectedNodePath changes
  useEffect(() => {
    if (!selectedNodePath) return;

    let isMounted = true;
    const fetchNodeDetails = async () => {
      try {
        const [neighRes, contentRes] = await Promise.all([
          fetchNeighbors(selectedNodePath),
          readNodeContent(selectedNodePath),
        ]);

        if (isMounted) {
          setNeighbors(neighRes);
          if (contentRes.content) {
            setNoteContent(contentRes.content);
          } else {
            setNoteContent("# Note Content\n\n*No raw markdown content available for this note.*");
          }
        }
      } catch (err) {
        console.error("Error fetching node detail:", err);
      }
    };

    fetchNodeDetails();
    return () => {
      isMounted = false;
    };
  }, [selectedNodePath]);

  // Real files on disk ONLY (filter out uncreated stubs)
  const realFilesOnly = useMemo(() => {
    return nodes.filter((n) => n.is_existing_file === true);
  }, [nodes]);


  // Filter real files by search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return realFilesOnly;
    const q = searchQuery.toLowerCase();
    return realFilesOnly.filter(
      (n) =>
        n.path.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [realFilesOnly, searchQuery]);

  // Group real files by folder
  const folderTree = useMemo(() => {
    const groups: Record<string, NodeItem[]> = {};
    filteredFiles.forEach((node) => {
      const parts = node.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Vault Root";
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(node);
    });
    return groups;
  }, [filteredFiles]);

  // Helper dictionary to lookup node data by path
  const nodeMap = useMemo(() => {
    const map: Record<string, NodeItem> = {};
    nodes.forEach((n) => {
      map[n.path] = n;
    });
    return map;
  }, [nodes]);

  // Render markdown text with clickable [[wiki-links]] and proper formatting preview
  const renderFormattedContent = (text: string) => {
    if (!text) return null;

    const parseInline = (textLine: string) => {
      // Split by wiki-links: [[Target]] or [[Target|Label]]
      const parts = textLine.split(/(\[\[[^\]]+\]\])/g);
      return parts.map((part, idx) => {
        if (part.startsWith("[[") && part.endsWith("]]")) {
          const inner = part.slice(2, -2);
          const segments = inner.split("|");
          const target = segments[0].split("#")[0].trim();
          const label = segments[1]?.trim() || target;
          
          const targetNode = nodeMap[target];
          const isReal = targetNode && targetNode.is_existing_file !== false;

          return (
            <span
              key={`link-${idx}`}
              onClick={() => setSelectedNodePath(target)}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs cursor-pointer transition-colors mx-1 font-sans shadow-sm font-medium ${
                isReal
                  ? "bg-[#A0548D]/25 border border-[#A0548D]/40 text-[#FFFFE8] hover:bg-[#A0548D]/40"
                  : "bg-white/5 border border-dashed border-white/20 text-[#FFFFE8]/70 hover:bg-white/10"
              }`}
              title={isReal ? `Open note: ${target}` : `Uncreated note link: ${target}`}
            >
              {isReal ? (
                <LinkIcon className="w-3.5 h-3.5 text-[#A0548D]" />
              ) : (
                <FilePlus className="w-3.5 h-3.5 text-white/40" />
              )}
              {label}
            </span>
          );
        }

        // Bold parsing: **text**
        const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
        return boldParts.map((bPart, bIdx) => {
          if (bPart.startsWith("**") && bPart.endsWith("**")) {
            return <strong key={`bold-${bIdx}`} className="font-bold text-white">{bPart.slice(2, -2)}</strong>;
          }

          // Italic parsing: *text*
          const italicParts = bPart.split(/(\*[^*]+\*)/g);
          return italicParts.map((iPart, iIdx) => {
            if (iPart.startsWith("*") && iPart.endsWith("*")) {
              return <em key={`italic-${iIdx}`} className="italic text-[#FFFFE8]/80">{iPart.slice(1, -1)}</em>;
            }
            return iPart;
          });
        });
      });
    };

    const lines = text.split("\n");
    const blocks: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 1. Code Block
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3);
        let code = "";
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          code += lines[i] + "\n";
          i++;
        }
        blocks.push(
          <div key={`code-${i}`} className="my-4 bg-black/50 rounded-xl border border-white/10 p-4 font-mono text-xs overflow-x-auto select-text text-emerald-300">
            {lang && <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2 font-sans select-none">{lang}</div>}
            <pre className="leading-relaxed whitespace-pre">{code.trim()}</pre>
          </div>
        );
        i++;
        continue;
      }

      // 2. Table
      if (line.trim().startsWith("|")) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          tableLines.push(lines[i]);
          i++;
        }

        const parseRow = (rowText: string) => {
          return rowText
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        };

        if (tableLines.length > 0) {
          const headers = parseRow(tableLines[0]);
          const rows = tableLines.slice(2).map((r) => parseRow(r)); // skip header divider
          blocks.push(
            <div key={`table-${i}`} className="my-4 overflow-x-auto border border-white/10 rounded-xl bg-black/20">
              <table className="min-w-full divide-y divide-white/10 text-xs">
                <thead className="bg-white/5">
                  <tr>
                    {headers.map((h, idx) => (
                      <th key={idx} className="px-4 py-2.5 text-left font-semibold text-white uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-white/5 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-4 py-2 text-[#FFFFE8]/90 font-sans">
                          {parseInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        continue;
      }

      // 3. Headings
      if (line.trim().startsWith("#")) {
        const match = line.trim().match(/^(#{1,6})\s+(.*)$/);
        if (match) {
          const level = match[1].length;
          const headingText = match[2];
          const classes =
            level === 1
              ? "text-xl font-bold text-white border-b border-white/10 pb-1 mt-6 mb-3 font-sans"
              : level === 2
              ? "text-lg font-semibold text-[#A0548D] mt-5 mb-2.5 font-sans"
              : "text-sm font-semibold text-[#FFFFE8] mt-4 mb-2 font-sans";
          blocks.push(
            React.createElement(`h${level}`, { key: `h-${i}`, className: classes }, parseInline(headingText))
          );
          i++;
          continue;
        }
      }

      // 4. Blockquotes
      if (line.trim().startsWith(">")) {
        blocks.push(
          <blockquote key={`quote-${i}`} className="my-3 pl-4 border-l-4 border-[#A0548D] italic text-[#FFFFE8]/70 text-sm font-sans leading-relaxed">
            {parseInline(line.slice(1).trim())}
          </blockquote>
        );
        i++;
        continue;
      }

      // 5. Unordered List Items
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        blocks.push(
          <div key={`list-${i}`} className="flex items-start gap-2 pl-4 my-1.5 text-sm font-sans leading-relaxed text-[#FFFFE8]/90">
            <span className="text-[#A0548D] mt-1 shrink-0 select-none">•</span>
            <div>{parseInline(line.trim().slice(2))}</div>
          </div>
        );
        i++;
        continue;
      }

      // 6. Plain Paragraph (skipping empty lines)
      if (line.trim() !== "") {
        blocks.push(
          <p key={`p-${i}`} className="my-2.5 text-sm font-sans leading-relaxed text-[#FFFFE8]/90">
            {parseInline(line)}
          </p>
        );
      }

      i++;
    }

    return <div className="space-y-1 select-text">{blocks}</div>;
  };


  const tabs = [
    { id: "content", label: "Content" },
    { id: "graph", label: "Graph Links" },
    { id: "metadata", label: "Metadata" },
  ] as const;

  return (
    <div className="w-full max-w-6xl h-[82vh] flex items-center justify-center p-4 z-10 select-none font-sans">
      {/* Main Glass Card with Framer Motion Entrance */}
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[32px] p-6 flex flex-col gap-4 shadow-2xl relative overflow-hidden transition-shadow duration-300 text-[#FFFFE8]"
        style={{
          backgroundImage:
            "radial-gradient(circle 450px at var(--mx, 50%) var(--my, 50%), rgba(160, 84, 141, 0.16) 0%, transparent 80%)",
        }}
      >
        {/* Card Header Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10 shrink-0">
          <div>
            <h1 className="text-2xl font-semibold text-[#FFFFE8] tracking-tight font-sans flex items-center gap-2">
              <Activity className="w-6 h-6 text-[#A0548D]" />
              Vault Discovery & Index Explorer
            </h1>
            <p className="text-xs text-[#FFFFE8]/60 mt-0.5 font-sans flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isSyncing ? "bg-amber-400 animate-ping" : "bg-emerald-400"}`} />
              {isSyncing ? "Scanning vault index..." : `${realFilesCount} Vault Notes • ${totalLinks} Link Edges • ${orphans.length} Orphans`}
              {activeVaultPath && (
                <span className="text-white/40 truncate max-w-xs font-mono text-[11px]">({activeVaultPath})</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-4 h-4 absolute left-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes or tags..."
                className="bg-white/5 border border-white/10 rounded-xl py-1.5 pl-9 pr-4 text-xs text-[#FFFFE8] placeholder-white/40 focus:outline-none focus:border-[#A0548D] w-56 transition-all focus:w-64 font-sans"
              />
            </div>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handlePickVaultAndIndex}
              title="Change Vault Folder"
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-all font-sans cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#A0548D]" />
              Vault Folder
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => loadData(true)}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-all disabled:opacity-50 font-sans cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-[#A0548D]" : ""}`} />
              Re-index
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/prompt")}
              className="flex items-center gap-1.5 bg-[#A0548D] hover:bg-[#884377] text-white px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all font-sans shadow-lg cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-white" />
              Prompt Agent
            </motion.button>
          </div>
        </header>


        {/* Main Content Area: Split Sidebar & Reading Canvas */}
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
          {/* Left Explorer Sidebar (Hidden Scrollbar) */}
          <aside className="w-72 bg-white/5 rounded-2xl p-3 border border-white/10 flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
              <span className="text-xs font-semibold text-[#FFFFE8]/80 uppercase tracking-wider font-sans flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-[#A0548D]" /> Explorer
              </span>
              <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-[#FFFFE8]/70 font-sans">
                {filteredFiles.length} files
              </span>
            </div>

            {/* Hidden scrollbar on sidebar using Tailwind utility */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {realFilesOnly.length === 0 ? (
                <div className="p-4 text-center space-y-3">
                  <p className="text-xs text-[#FFFFE8]/50 italic font-sans">
                    {isSyncing ? "Indexing vault notes..." : "No notes found in configured directory."}
                  </p>
                  {!isSyncing && (
                    <button
                      onClick={handlePickVaultAndIndex}
                      className="px-3 py-1.5 bg-[#A0548D]/30 border border-[#A0548D] rounded-xl text-xs text-white hover:bg-[#A0548D]/50 transition-all font-sans cursor-pointer"
                    >
                      Select Vault Folder
                    </button>
                  )}
                </div>
              ) : Object.keys(folderTree).length === 0 ? (
                <div className="text-xs text-[#FFFFE8]/50 p-4 text-center italic font-sans">
                  No notes matching query.
                </div>
              ) : (
                Object.entries(folderTree).map(([folder, folderNodes]) => (
                  <div key={folder} className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs text-[#FFFFE8]/70 font-medium px-1 font-sans">
                      <Folder className="w-3.5 h-3.5 text-[#A0548D]" />
                      <span>{folder}</span>
                    </div>

                    <div className="pl-3 space-y-1 border-l border-white/10 ml-2">
                      {folderNodes.map((n) => {
                        const isSelected = n.path === selectedNodePath;
                        const filename = n.path.split("/").pop() || n.path;
                        return (
                          <motion.div
                            key={n.path}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setSelectedNodePath(n.path)}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-xl cursor-pointer transition-colors text-xs font-sans ${
                              isSelected
                                ? "bg-[#A0548D]/30 border-l-2 border-[#A0548D] text-white font-medium shadow-sm"
                                : "text-[#FFFFE8]/80 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <FileText className={`w-3.5 h-3.5 ${isSelected ? "text-[#A0548D]" : "text-white/40"}`} />
                              <span className="truncate">{filename}</span>
                            </div>
                            {n.in_degree > 0 && (
                              <span className="text-[10px] bg-[#A0548D]/20 text-[#FFFFE8] px-1.5 py-0.5 rounded shrink-0 font-medium">
                                {n.in_degree}
                              </span>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Right Main Focus Canvas */}
          <section className="flex-1 bg-white/5 rounded-2xl p-4 border border-white/10 flex flex-col min-w-0 overflow-hidden">
            {/* Canvas Header Bar */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-[#FFFFE8] truncate font-sans flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#A0548D]" />
                  {selectedNodePath ? selectedNodePath.split("/").pop() : "Select a Note"}
                </h3>
                <p className="text-xs text-[#FFFFE8]/50 truncate font-sans">
                  {selectedNodePath ? `/${selectedNodePath}` : "Select a note from the left sidebar to explore connections"}
                </p>
              </div>

              {/* View Mode Switcher with Smooth Sliding Magenta Pill Animation */}
              <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 text-xs font-sans relative">
                {tabs.map((tab) => {
                  const isActive = viewMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setViewMode(tab.id)}
                      className={`relative px-3.5 py-1 rounded-lg transition-colors font-medium cursor-pointer ${
                        isActive ? "text-white" : "text-[#FFFFE8]/70 hover:text-white"
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="segmentedTabHighlight"
                          className="absolute inset-0 bg-[#A0548D] rounded-lg -z-10 shadow-md"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Animated Canvas Content Views */}
            <div className="flex-1 overflow-y-auto py-4 pr-1 scrollbar-thin min-h-0 relative">
              <AnimatePresence mode="wait">
                {viewMode === "content" && (
                  <motion.div
                    key="content"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="bg-black/30 p-5 rounded-xl border border-white/5 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#FFFFE8]/90"
                  >
                    {renderFormattedContent(noteContent)}
                  </motion.div>
                )}

                {viewMode === "graph" && (
                  <motion.div
                    key="graph"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4 font-sans"
                  >
                    {/* Incoming Links */}
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                      <h4 className="text-xs font-semibold text-[#A0548D] uppercase tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ArrowDownLeft className="w-4 h-4 text-[#A0548D]" />
                          Incoming Links (Referenced By)
                        </span>
                        <span className="text-[10px] bg-[#A0548D]/30 px-2 py-0.5 rounded text-white font-medium">
                          {neighbors?.incoming?.length || 0}
                        </span>
                      </h4>
                      {neighbors?.incoming && neighbors.incoming.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {neighbors.incoming.map((inc) => {
                            const incNode = nodeMap[inc];
                            const isReal = incNode && incNode.is_existing_file !== false;
                            return (
                              <motion.div
                                key={inc}
                                whileHover={{ scale: 1.02, x: 2 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setSelectedNodePath(inc)}
                                className={`p-3 bg-white/5 hover:bg-[#A0548D]/25 border rounded-xl cursor-pointer transition-all text-xs text-[#FFFFE8] flex items-center justify-between gap-2 shadow-sm ${
                                  isReal ? "border-white/10 hover:border-[#A0548D]/50" : "border-dashed border-white/20 opacity-75"
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <ArrowDownLeft className="w-4 h-4 text-[#A0548D] shrink-0" />
                                  <span className="font-medium truncate">{inc}</span>
                                </div>
                                <span className="text-[10px] bg-[#A0548D]/20 text-[#FFFFE8] px-2 py-0.5 rounded font-mono shrink-0">
                                  {isReal ? "Note File" : "Uncreated Link"}
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-[#FFFFE8]/40 italic">No incoming links to this note.</p>
                      )}
                    </div>

                    {/* Outgoing Links */}
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                      <h4 className="text-xs font-semibold text-[#A0548D] uppercase tracking-wider flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ArrowUpRight className="w-4 h-4 text-[#A0548D]" />
                          Outgoing Links (References)
                        </span>
                        <span className="text-[10px] bg-[#A0548D]/30 px-2 py-0.5 rounded text-white font-medium">
                          {neighbors?.outgoing?.length || 0}
                        </span>
                      </h4>
                      {neighbors?.outgoing && neighbors.outgoing.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {neighbors.outgoing.map((out) => {
                            const outNode = nodeMap[out];
                            const isReal = outNode && outNode.is_existing_file !== false;
                            return (
                              <motion.div
                                key={out}
                                whileHover={{ scale: 1.02, x: 2 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setSelectedNodePath(out)}
                                className={`p-3 bg-white/5 hover:bg-[#A0548D]/25 border rounded-xl cursor-pointer transition-all text-xs text-[#FFFFE8] flex items-center justify-between gap-2 shadow-sm ${
                                  isReal ? "border-white/10 hover:border-[#A0548D]/50" : "border-dashed border-white/20 opacity-75"
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <ArrowUpRight className="w-4 h-4 text-[#A0548D] shrink-0" />
                                  <span className="font-medium truncate">{out}</span>
                                </div>

                                <span className="text-[10px] bg-[#A0548D]/20 text-[#FFFFE8] px-2 py-0.5 rounded font-mono shrink-0">
                                  {isReal ? "Note File" : "Uncreated Link"}
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-[#FFFFE8]/40 italic">No outgoing links from this note.</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {viewMode === "metadata" && (
                  <motion.div
                    key="metadata"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4 font-sans"
                  >
                    {/* Frontmatter */}
                    <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-2">
                      <h4 className="text-xs font-semibold text-[#A0548D] uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-[#A0548D]" />
                        YAML Frontmatter
                      </h4>
                      {neighbors?.frontmatter && Object.keys(neighbors.frontmatter).length > 0 ? (
                        <div className="bg-black/40 p-3 rounded-xl border border-white/5 text-xs text-[#FFFFE8] space-y-1 font-mono">
                          {Object.entries(neighbors.frontmatter).map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                              <span className="text-[#A0548D] font-medium shrink-0">{k}:</span>
                              <span className="text-[#FFFFE8]/80 break-all">{JSON.stringify(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[#FFFFE8]/40 italic">No frontmatter defined.</p>
                      )}
                    </div>

                    {/* Headings & Tags */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-2">
                        <h4 className="text-xs font-semibold text-[#A0548D] uppercase tracking-wider flex items-center gap-1.5">
                          <TagIcon className="w-4 h-4 text-[#A0548D]" /> Tags
                        </h4>
                        {neighbors?.tags && neighbors.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {neighbors.tags.map((t) => (
                              <span key={t} className="px-2.5 py-1 bg-[#A0548D]/20 border border-[#A0548D]/40 text-[#FFFFE8] rounded-lg text-xs font-sans">
                                #{t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[#FFFFE8]/40 italic">No tags associated.</p>
                        )}
                      </div>

                      <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-2">
                        <h4 className="text-xs font-semibold text-[#FFFFE8] uppercase tracking-wider flex items-center gap-1.5">
                          <ListIcon className="w-4 h-4 text-[#A0548D]" /> Headings Outline
                        </h4>
                        {neighbors?.headings && neighbors.headings.length > 0 ? (
                          <div className="space-y-1 text-xs text-[#FFFFE8]/80">
                            {neighbors.headings.map((h, i) => (
                              <div key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }} className="truncate">
                                <span className="text-[#A0548D] font-medium mr-1">H{h.level}</span>
                                {h.text}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[#FFFFE8]/40 italic">No headings found.</p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Canvas Footer: Connected Links */}
            <footer className="pt-3 border-t border-white/10 shrink-0 font-sans">
              <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <span className="text-xs text-[#FFFFE8]/60 shrink-0 font-medium uppercase tracking-wider flex items-center gap-1">
                  <LinkIcon className="w-3.5 h-3.5 text-[#A0548D]" /> Connected:
                </span>
                {(!neighbors?.incoming?.length && !neighbors?.outgoing?.length) ? (
                  <span className="text-xs text-[#FFFFE8]/40 italic">No connected links</span>
                ) : (
                  <>
                    {neighbors?.incoming?.map((inc) => (
                      <motion.button
                        key={`inc-${inc}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedNodePath(inc)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 hover:bg-[#A0548D]/30 border border-white/10 text-xs text-[#FFFFE8] shrink-0 transition-all cursor-pointer font-medium"
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5 text-[#A0548D]" />
                        {inc}
                      </motion.button>
                    ))}
                    {neighbors?.outgoing?.map((out) => (
                      <motion.button
                        key={`out-${out}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedNodePath(out)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 hover:bg-[#A0548D]/30 border border-white/10 text-xs text-[#FFFFE8] shrink-0 transition-all cursor-pointer font-medium"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5 text-[#A0548D]" />
                        {out}
                      </motion.button>
                    ))}

                  </>
                )}
              </div>
            </footer>
          </section>
        </div>
      </motion.div>
    </div>
  );
};
