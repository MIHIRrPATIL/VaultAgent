import asyncio
import os
import sys
import shutil

# Add server directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.writer import writer_agent
from schemas import SynthesizedNoteDraft

# Load .env manually if it exists
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

async def run_writer_test():
    print("=" * 70)
    print("Testing WriterAgent with Async stage_notes and Polishing")
    print("=" * 70)

    # Set up a temp directory for vault simulation
    temp_vault = os.path.join(os.path.dirname(__file__), "temp_test_vault")
    os.makedirs(temp_vault, exist_ok=True)

    try:
        drafts = [
            SynthesizedNoteDraft(
                title="Dijkstra's Algorithm",
                suggested_filename="dijkstra-algorithm",
                body_markdown="""# Dijkstra's Algorithm
Dijkstra's algorithm finds the shortest path between nodes in a graph.
It relies heavily on [[graph-theory]] concepts and is similar to [[binary-search-tree]] in path searches.
Here is a wiki link: [[recursion]].""",
                tags=["algorithms", "graph"],
                aliases=["Dijkstra", "Shortest Path"]
            )
        ]

        # Test Case 1: Fallback (No API Keys)
        print("\nTest Case 1: Verification of fallback logic (no API keys)...")
        staged_fallback = await writer_agent.stage_notes(
            drafts=drafts,
            vault_path=temp_vault,
            save_subfolder="/Generated",
            naming_convention="kebab",
            style_preset="technical",
            gemini_key=None,
            openrouter_key=None
        )

        assert len(staged_fallback) == 1, "Should stage one file"
        file = staged_fallback[0]
        print(f"  Staged file name: {file.filename}")
        print(f"  Target path: {file.full_target_path}")
        assert file.filename == "dijkstra-algorithm.md", "Filename formatting failed"
        assert "tags:\n- algorithms\n- graph" in file.content, "Frontmatter tags missing"
        assert "aliases:\n- Dijkstra\n- Shortest Path" in file.content, "Frontmatter aliases missing"
        assert "[[graph-theory]]" in file.content, "Original links missing in fallback"
        print("  Test Case 1: Passed!")

        # Test Case 2: Polishing with Gemini API Key if available
        gemini_key = os.getenv("GEMINI_API_KEY")
        openrouter_key = os.getenv("OPENROUTER_API_KEY")

        if gemini_key or openrouter_key:
            print(f"\nTest Case 2: Verification of LLM-based styling (using active key)...")
            staged_styled = await writer_agent.stage_notes(
                drafts=drafts,
                vault_path=temp_vault,
                save_subfolder="/Generated",
                naming_convention="kebab",
                style_preset="technical",
                gemini_key=gemini_key,
                openrouter_key=openrouter_key
            )
            
            polished_file = staged_styled[0]
            print(f"  Polished content preview:\n---\n{polished_file.content[:600]}\n---")
            
            # Verify critical rules
            assert "[[graph-theory]]" in polished_file.content, "CRITICAL ERROR: Wiki-links lost in LLM polishing pass"
            assert "[[binary-search-tree]]" in polished_file.content, "CRITICAL ERROR: Wiki-links lost in LLM polishing pass"
            assert "[[recursion]]" in polished_file.content, "CRITICAL ERROR: Wiki-links lost in LLM polishing pass"
            print("  Test Case 2: Passed! Links preserved successfully in LLM output.")
        else:
            print("\n[SKIP] Test Case 2 skipped: No API key found in environment for live verification.")

    finally:
        # Clean up temp directory
        if os.path.exists(temp_vault):
            shutil.rmtree(temp_vault)
            print("\nCleaned up simulated vault directory.")

if __name__ == "__main__":
    asyncio.run(run_writer_test())
