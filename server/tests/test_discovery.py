import asyncio
import sys
import os

# Add server directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.discovery import discovery_agent

# Load .env manually if it exists
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

async def run_test():
    async def progress_cb(msg: str, pct: int):
        print(f"  [{pct}%] {msg}")

    print("=" * 70)
    print("RUN 1: Testing WebDiscoveryAgent with User-Supplied URLs (HTTPX Scraping)")
    print("=" * 70)
    
    test_urls = [
        "https://en.wikipedia.org/wiki/Binary_search_tree",
        "https://en.wikipedia.org/wiki/Graph_theory"
    ]
    
    result = await discovery_agent.execute_research(
        topic="Data Structures & Algorithms Research",
        user_urls=test_urls,
        search_provider="duckduckgo",
        scrape_provider="httpx",
        progress_callback=progress_cb
    )
    print(f"Total Sources Succeeded (Run 1): {result.sources_succeeded} / {result.sources_attempted}")
    print(f"Combined Context Size (Run 1)  : {len(result.combined_deduped_context):,} characters\n")

    tavily_key = os.getenv("TAVILY_API_KEY")
    if tavily_key:
        print("=" * 70)
        print("RUN 2: Testing Live Tavily Search & Discovery via .env API Key")
        print("=" * 70)
        
        result2 = await discovery_agent.execute_research(
            topic="Tauri desktop application sidecar framework development",
            search_provider="tavily",
            scrape_provider="httpx",
            tavily_key=tavily_key,
            openrouter_key=os.getenv("OPENROUTER_API_KEY"),
            progress_callback=progress_cb
        )
        print(f"Total Sources Succeeded (Run 2): {result2.sources_succeeded} / {result2.sources_attempted}")
        print(f"Combined Context Size (Run 2)  : {len(result2.combined_deduped_context):,} characters\n")
    else:
        print("[NOTICE] TAVILY_API_KEY not found in .env, skipping Tavily test.\n")

    print("=" * 70)
    print("RUN 3: Testing Live Anonymous DuckDuckGo Web Search & Discovery")
    print("=" * 70)
    
    result3 = await discovery_agent.execute_research(
        topic="Tauri desktop application sidecar framework development",
        search_provider="duckduckgo",
        scrape_provider="httpx",
        openrouter_key=os.getenv("OPENROUTER_API_KEY"),
        progress_callback=progress_cb
    )
    print(f"Total Sources Succeeded (Run 3): {result3.sources_succeeded} / {result3.sources_attempted}")
    print(f"Combined Context Size (Run 3)  : {len(result3.combined_deduped_context):,} characters\n")

if __name__ == "__main__":
    asyncio.run(run_test())
