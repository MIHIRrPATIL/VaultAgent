from duckduckgo_search import DDGS

try:
    with DDGS() as ddgs:
        # Try a simple text search
        for r in ddgs.text("Python programming", max_results=3):
            print("Found:", r)
except Exception as e:
    print("Error:", e)
