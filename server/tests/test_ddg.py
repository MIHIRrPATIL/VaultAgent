from duckduckgo_search import DDGS
import json

try:
    results = DDGS().text("Tauri framework", max_results=3)
    print("Results:", list(results))
except Exception as e:
    print("Error:", e)
