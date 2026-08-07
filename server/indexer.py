import os
import re
import hashlib
import pickle
import yaml
from typing import List, Dict, Any, Set, Optional
import networkx as nx
from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin
import aiofiles

DEFAULT_EXCLUDES = {"Templates", "Attachments", ".trash", ".obsidian", "node_modules", "Backup"}

class VaultIndexer:
    def __init__(self):
        self.md = MarkdownIt("commonmark").use(front_matter_plugin)
        self.graph = nx.DiGraph()
        self.hashes: Dict[str, str] = {}
        self.alias_map: Dict[str, str] = {} # maps title/alias variants -> canonical relative path
        self.config: Dict[str, Any] = {}

    def _get_index_path(self, vault_path: str) -> str:
        return os.path.join(vault_path, ".vault_agent_index.pkl")

    def load_graph(self, vault_path: str):
        index_path = self._get_index_path(vault_path)
        if os.path.exists(index_path):
            try:
                with open(index_path, 'rb') as f:
                    data = pickle.load(f)
                    self.graph = data.get("graph", nx.DiGraph())
                    self.hashes = data.get("hashes", {})
                    self.alias_map = data.get("alias_map", {})
                    self.config = data.get("config", {})
            except Exception as e:
                print(f"[VaultIndexer] Error loading index pickle: {e}. Rebuilding...")
                self.graph = nx.DiGraph()
                self.hashes = {}
                self.alias_map = {}
                self.config = {}
        else:
            self.graph = nx.DiGraph()
            self.hashes = {}
            self.alias_map = {}
            self.config = {}

    def save_graph(self, vault_path: str):
        index_path = self._get_index_path(vault_path)
        try:
            with open(index_path, 'wb') as f:
                pickle.dump({
                    "graph": self.graph,
                    "hashes": self.hashes,
                    "alias_map": self.alias_map,
                    "config": self.config
                }, f)
        except Exception as e:
            print(f"[VaultIndexer] Error saving index pickle: {e}")

    async def _calculate_hash(self, filepath: str) -> str:
        sha256_hash = hashlib.sha256()
        async with aiofiles.open(filepath, "rb") as f:
            while chunk := await f.read(8192):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest()

    async def _parse_file(self, filepath: str, rel_path: str):
        async with aiofiles.open(filepath, "r", encoding="utf-8") as f:
            content = await f.read()

        tokens = self.md.parse(content)
        
        frontmatter: Dict[str, Any] = {}
        headings: List[Dict[str, Any]] = []
        links: Set[str] = set()
        tags: Set[str] = set()
        aliases: Set[str] = set()

        # Regex for [[wiki-links]]: [[target]] or [[target|alias]] or [[target#heading]]
        wiki_link_pattern = re.compile(r'\[\[([^\]\|#]+)(?:[\|#][^\]]+)?\]\]')
        # Regex for inline #tags (avoiding hex colors or headers)
        inline_tag_pattern = re.compile(r'(?:^|\s)#([a-zA-Z0-9_\-/]+)')

        i = 0
        while i < len(tokens):
            token = tokens[i]

            if token.type == "front_matter":
                try:
                    parsed_fm = yaml.safe_load(token.content)
                    if isinstance(parsed_fm, dict):
                        frontmatter = parsed_fm
                        
                        # Extract tags from frontmatter
                        fm_tags = frontmatter.get("tags") or frontmatter.get("tag")
                        if isinstance(fm_tags, list):
                            for t in fm_tags:
                                tags.add(str(t).strip("#"))
                        elif isinstance(fm_tags, str):
                            for t in fm_tags.split(","):
                                tags.add(t.strip().strip("#"))

                        # Extract aliases from frontmatter
                        fm_aliases = frontmatter.get("aliases") or frontmatter.get("alias")
                        if isinstance(fm_aliases, list):
                            for a in fm_aliases:
                                aliases.add(str(a).strip())
                        elif isinstance(fm_aliases, str):
                            for a in fm_aliases.split(","):
                                aliases.add(a.strip())
                except yaml.YAMLError:
                    pass

            elif token.type == "heading_open":
                # Next token is inline containing the heading text
                if i + 1 < len(tokens) and tokens[i + 1].type == "inline":
                    heading_text = tokens[i + 1].content.strip()
                    heading_level = int(token.tag.replace("h", "")) if token.tag.startswith("h") else 1
                    headings.append({"level": heading_level, "text": heading_text})

            elif token.type == "inline":
                # Find [[wiki-links]]
                found_links = wiki_link_pattern.findall(token.content)
                for link in found_links:
                    links.add(link.strip())

                # Find inline #tags
                found_tags = inline_tag_pattern.findall(token.content)
                for t in found_tags:
                    tags.add(t.strip())

            i += 1

        # Also register file basename and title as alias mappings
        filename = os.path.basename(rel_path)
        basename_no_ext = os.path.splitext(filename)[0]
        aliases.add(basename_no_ext)
        aliases.add(rel_path)

        return {
            "frontmatter": frontmatter,
            "headings": headings,
            "links": list(links),
            "tags": list(tags),
            "aliases": list(aliases)
        }

    def _resolve_link_target(
        self, 
        link: str, 
        alias_map_lower: Optional[Dict[str, str]] = None, 
        heading_map: Optional[Dict[str, str]] = None
    ) -> str:
        """Resolves a wiki-link string to its canonical node path in the graph."""
        clean_link = link.strip().split("|")[0].split("#")[0].strip()
        if not clean_link:
            return link.strip()

        # Check alias map direct match
        if clean_link in self.alias_map:
            return self.alias_map[clean_link]
            
        clean_lower = clean_link.lower()
        
        # Check case-insensitive alias map
        if alias_map_lower and clean_lower in alias_map_lower:
            return alias_map_lower[clean_lower]
        elif not alias_map_lower:
            # Fallback slow lookup
            for alias_key, canonical in self.alias_map.items():
                if alias_key.lower() == clean_lower:
                    return canonical

        # Check heading match
        if heading_map and clean_lower in heading_map:
            return heading_map[clean_lower]
        elif not heading_map:
            # Fallback slow lookup
            for node_name, data in self.graph.nodes(data=True):
                headings = data.get("headings", [])
                for h in headings:
                    if h.get("text", "").strip().lower() == clean_lower:
                        return node_name

        return clean_link

    async def scan_vault(self, vault_path: str, force: bool = False, excludes: Optional[Set[str]] = None, config: Optional[Dict[str, Any]] = None):
        if excludes is None:
            excludes = DEFAULT_EXCLUDES
        else:
            excludes = set(excludes) | DEFAULT_EXCLUDES

        if config:
            self.config.update(config)

        self.load_graph(vault_path)

        if force:
            self.graph.clear()
            self.hashes.clear()
            self.alias_map.clear()

        current_files: Set[str] = set()

        # 1st Pass: Discover files, calculate hashes, parse modified files, and populate alias_map
        for root, dirs, files in os.walk(vault_path):
            # Exclude specified folders
            dirs[:] = [d for d in dirs if d not in excludes and not d.startswith(".")]

            for file in files:
                if file in excludes or file.startswith(".") or not file.endswith(".md"):
                    continue

                filepath = os.path.join(root, file)
                rel_path = os.path.relpath(filepath, vault_path)
                canonical_name = rel_path[:-3] # strip .md
                current_files.add(canonical_name)

                file_hash = await self._calculate_hash(filepath)

                if force or self.hashes.get(canonical_name) != file_hash or not self.graph.has_node(canonical_name):
                    # File changed or new: parse
                    parsed_data = await self._parse_file(filepath, canonical_name)
                    self.hashes[canonical_name] = file_hash

                    # Update alias map for this file
                    for alias in parsed_data["aliases"]:
                        self.alias_map[alias] = canonical_name

                    is_generated = False
                    custom_save_path = self.config.get("custom_save_path", "/Generated").strip("/")
                    if custom_save_path and canonical_name.startswith(custom_save_path):
                        is_generated = True

                    self.graph.add_node(
                        canonical_name,
                        filepath=filepath,
                        frontmatter=parsed_data["frontmatter"],
                        headings=parsed_data["headings"],
                        tags=parsed_data["tags"],
                        aliases=parsed_data["aliases"],
                        links=parsed_data["links"],
                        is_generated=is_generated,
                        is_existing_file=True,
                        hash=file_hash
                    )
                else:
                    # File already indexed in graph, ensure attributes are updated
                    self.graph.nodes[canonical_name]["filepath"] = filepath
                    self.graph.nodes[canonical_name]["is_existing_file"] = True

        # Precompute lowercase lookup maps once to speed up resolution from O(N*H) to O(1)
        alias_map_lower = {k.lower(): v for k, v in self.alias_map.items()}
        heading_map = {}
        for node_name, data in self.graph.nodes(data=True):
            headings = data.get("headings", [])
            for h in headings:
                text = h.get("text", "").strip().lower()
                if text and text not in heading_map:
                    heading_map[text] = node_name

        # Re-build outgoing edges for all current files
        for canonical_name in current_files:
            node_data = self.graph.nodes[canonical_name]
            links = node_data.get("links", [])

            # Remove old outgoing edges
            out_edges = list(self.graph.out_edges(canonical_name))
            self.graph.remove_edges_from(out_edges)

            # Add resolved outgoing edges
            for raw_link in links:
                target_node = self._resolve_link_target(raw_link, alias_map_lower, heading_map)
                self.graph.add_edge(canonical_name, target_node, raw_link=raw_link)

        # Flag nodes created as link targets that are NOT actual .md files on disk
        for node in list(self.graph.nodes()):
            if node not in current_files:
                self.graph.nodes[node]["is_existing_file"] = False

        # Remove deleted files from graph, hashes, and alias map
        deleted_files = set(self.hashes.keys()) - current_files
        for df in deleted_files:
            if self.graph.has_node(df):
                self.graph.remove_node(df)
            if df in self.hashes:
                del self.hashes[df]
            # Clean up alias map
            keys_to_del = [k for k, v in self.alias_map.items() if v == df]
            for k in keys_to_del:
                del self.alias_map[k]

        self.save_graph(vault_path)
        return {
            "status": "success",
            "nodes": self.graph.number_of_nodes(),
            "real_files": len(current_files),
            "edges": self.graph.number_of_edges(),
            "aliases_indexed": len(self.alias_map),
            "config": self.config
        }

    def get_neighbors(self, path: str):
        canonical = self._resolve_link_target(path)
        if not self.graph.has_node(canonical):
            return {"error": f"Node '{path}' (canonical: '{canonical}') not found"}

        incoming = list(self.graph.predecessors(canonical))
        outgoing = list(self.graph.successors(canonical))
        node_data = self.graph.nodes[canonical]
        return {
            "canonical_path": canonical,
            "incoming": incoming,
            "outgoing": outgoing,
            "frontmatter": node_data.get("frontmatter", {}),
            "headings": node_data.get("headings", []),
            "tags": node_data.get("tags", []),
            "is_generated": node_data.get("is_generated", False)
        }

    def get_deep_links(self, path: str, depth: Optional[int] = None):
        canonical = self._resolve_link_target(path)
        if not self.graph.has_node(canonical):
            return {"error": f"Node '{path}' (canonical: '{canonical}') not found"}

        if depth is None:
            depth_setting = self.config.get("linking_depth", "deep")
            depth = 1 if depth_setting == "shallow" else 3

        lengths = nx.single_source_shortest_path_length(self.graph, canonical, cutoff=depth)
        return {"canonical_path": canonical, "depth_cutoff": depth, "connected_nodes": lengths}

    def get_orphans(self):
        orphans = [n for n, d in self.graph.degree() if d == 0]
        return orphans

    def get_top_nodes(self, limit: int = 10):
        in_degrees = list(self.graph.in_degree())
        in_degrees.sort(key=lambda x: x[1], reverse=True)
        return [{"node": node, "in_degree": count} for node, count in in_degrees[:limit]]

    def get_all_nodes(self):
        nodes_list = []
        for n, data in self.graph.nodes(data=True):
            fp = data.get("filepath", "")
            exists = data.get("is_existing_file")
            if exists is None:
                exists = bool(fp and os.path.exists(fp))
            nodes_list.append({
                "path": n,
                "tags": data.get("tags", []),
                "headings": data.get("headings", []),
                "is_generated": data.get("is_generated", False),
                "is_existing_file": bool(exists),
                "in_degree": self.graph.in_degree(n),
                "out_degree": self.graph.out_degree(n)
            })
        return nodes_list


    async def read_node_content(self, path: str):
        canonical = self._resolve_link_target(path)
        
        # 1. Direct filepath check from graph node data
        if self.graph.has_node(canonical):
            node_data = self.graph.nodes[canonical]
            filepath = node_data.get("filepath")
            if filepath and os.path.exists(filepath):
                try:
                    async with aiofiles.open(filepath, "r", encoding="utf-8") as f:
                        content = await f.read()
                    return {"canonical_path": canonical, "content": content}
                except Exception as e:
                    print(f"[read_node_content] Read error for {filepath}: {e}")

        # 2. Fallback search by vault path
        vault_path = self.config.get("vault_path", "")
        if not vault_path:
            vault_path = "/home/mihir/Documents/Obsidian/DSA/DSA"

        if vault_path and os.path.exists(vault_path):
            rel = canonical if canonical.endswith(".md") else f"{canonical}.md"
            full_path = os.path.join(vault_path, rel)
            if os.path.exists(full_path):
                try:
                    async with aiofiles.open(full_path, "r", encoding="utf-8") as f:
                        content = await f.read()
                    return {"canonical_path": canonical, "content": content}
                except Exception as e:
                    print(f"[read_node_content] Read error for {full_path}: {e}")

            # Search recursively for file matching canonical basename
            target_filename = os.path.basename(rel)
            for root, _, files in os.walk(vault_path):
                if target_filename in files:
                    target_path = os.path.join(root, target_filename)
                    try:
                        async with aiofiles.open(target_path, "r", encoding="utf-8") as f:
                            content = await f.read()
                        return {"canonical_path": canonical, "content": content}
                    except Exception as e:
                        print(f"[read_node_content] Read error for {target_path}: {e}")

        return {"error": f"Content not found for note '{path}'"}

indexer = VaultIndexer()


