import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agents.discovery import discovery_agent

async def run_reduction_test():
    print("=" * 75)
    print("Testing 4-Stage Reduction Pipeline on 5 Real Technical DSA Pages")
    print("=" * 75)
    
    test_urls = [
        "https://en.wikipedia.org/wiki/Binary_search_tree",
        "https://en.wikipedia.org/wiki/Graph_theory",
        "https://en.wikipedia.org/wiki/Dynamic_programming",
        "https://en.wikipedia.org/wiki/Depth-first_search",
        "https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm"
    ]
    
    async def progress_cb(msg: str, pct: int):
        print(f"  [{pct}%] {msg}")

    # Load OpenRouter API key from .env
    openrouter_key = None
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                if line.startswith("OPENROUTER_API_KEY="):
                    openrouter_key = line.split("=", 1)[1].strip()

    result = await discovery_agent.execute_research(
        topic="Binary Search Trees & Graph Algorithms",
        user_urls=test_urls,
        openrouter_key=openrouter_key,
        openrouter_model="poolside/laguna-s-2.1:free",
        progress_callback=progress_cb
    )

    raw_total_chars = sum(len(s.markdown_content) for s in result.sources if s.success)
    final_chars = len(result.combined_deduped_context)
    reduction_pct = ((raw_total_chars - final_chars) / raw_total_chars * 100) if raw_total_chars > 0 else 0

    print("\n" + "=" * 75)
    print("4-STAGE DATA REDUCTION BENCHMARK RESULTS")
    print("=" * 75)
    print(f"Total Sources Crawled   : {result.sources_succeeded}/{result.sources_attempted}")
    print(f"Raw Scraped Text Size   : {raw_total_chars:,} characters (~{raw_total_chars // 4:,} tokens)")
    print(f"Final Budgeted Payload  : {final_chars:,} characters (~{final_chars // 4:,} tokens)")
    print(f"Overall Data Reduction  : {reduction_pct:.2f}% reduction!")

    print("\n" + "=" * 75)
    print("FINAL REDUCED PAYLOAD PREVIEW (First 700 characters)")
    print("=" * 75)
    print(result.combined_deduped_context[:700])
    print("...\n" + "=" * 75)

if __name__ == "__main__":
    asyncio.run(run_reduction_test())
