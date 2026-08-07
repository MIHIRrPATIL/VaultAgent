import asyncio
import os
import sys
import json
from typing import Dict, Any, List
import networkx as nx

# Add server directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from indexer import VaultIndexer
from agents.linker import linker_agent

async def run_linker_test():
    print("=" * 70)
    print("Testing LinkerSynthesisAgent with Mock Vault Graph")
    print("=" * 70)

    # Load .env manually if it exists
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()

    # 1. Initialize a Mock VaultIndexer
    indexer = VaultIndexer()
    indexer.graph = nx.DiGraph()
    indexer.config = {"linking_depth": "deep"}

    # Add mock existing nodes to graph
    indexer.graph.add_node("graph-theory", is_existing_file=True, tags=["math", "algorithms"], headings=[{"text": "Introduction to Graph Theory"}], frontmatter={})
    indexer.graph.add_node("binary-search-tree", is_existing_file=True, tags=["data-structures"], headings=[{"text": "Binary Search Tree properties"}], frontmatter={})
    indexer.graph.add_node("recursion", is_existing_file=True, tags=["programming"], headings=[{"text": "Understanding Recursion"}], frontmatter={})

    # Populate alias map
    indexer.alias_map = {
        "Graph Theory": "graph-theory",
        "Binary Search Tree": "binary-search-tree",
        "Recursion": "recursion"
    }

    # 2. Build mock research context
    research_content = """
    Dijkstra's algorithm is an algorithm for finding the shortest paths between nodes in a graph.
    It was conceived by computer scientist Edsger W. Dijkstra in 1956 and published three years later.
    The algorithm exists in many variants. Dijkstra's original variant found the shortest path between two nodes,
    but a more common variant fixes a single node as the "source" node and finds shortest paths from the source to all other nodes in the graph,
    producing a shortest-path tree. It utilizes Graph Theory concepts and relies on depth-first search or breadth-first search principles, 
    often comparing to binary search tree operations for node selection.
    """

    # Get OpenRouter key from env
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_key:
        print("[WARNING] OPENROUTER_API_KEY not found in env. Falling back to deterministic draft notes.")

    # 3. Extract vault subgraph for context injection
    subgraph = linker_agent.extract_vault_subgraph(indexer, query="Dijkstra shortest path graph", depth="deep")
    print(f"Extracted Subgraph Candidates: {[c.filename for c in subgraph.candidate_notes]}\n")

    # 4. Generate LLM synthesis
    print("Invoking Linker LLM to synthesize interlinked draft notes...")
    drafts = await linker_agent.generate_llm_synthesis(
        prompt="Dijkstra's Shortest Path Algorithm implementation",
        research_context=research_content,
        subgraph=subgraph,
        style_preset="atomic",
        length="medium",
        openrouter_key=openrouter_key
    )

    print("\n" + "=" * 70)
    print(f"SYNTHESIZED DRAFTS ({len(drafts)} notes generated)")
    print("=" * 70)
    for idx, note in enumerate(drafts, 1):
        print(f"\n[{idx}] Title: {note.title}")
        print(f"    Suggested Filename: {note.suggested_filename}")
        print(f"    Tags: {note.tags}")
        print(f"    Is MOC: {note.is_moc}")
        print("-" * 50)
        print(note.body_markdown[:500] + "\n...")

    # 5. Validate links against the graph
    print("\n" + "=" * 70)
    print("VALIDATING WIKI-LINKS")
    print("=" * 70)
    result = linker_agent.validate_and_sanitize_links(drafts, indexer)
    print(f"Total Validated Wiki-links: {result.validated_links_count}")
    print(f"Stripped Fabricated Links: {result.stripped_fabricated_links}")
    
    for idx, note in enumerate(result.notes, 1):
        print(f"\nNote [{idx}] Proposed Links:")
        for link in note.proposed_links:
            status = "REAL (exists in vault)" if link.is_existing_in_vault else "SESSION (will be created in this session)"
            print(f"  - {link.raw_link} -> Canonical: {link.target_canonical} | {status}")

if __name__ == "__main__":
    asyncio.run(run_linker_test())
