from duckduckgo_search import DDGS

with DDGS() as ddgs:
    print("Trying default text search:")
    try:
        res = list(ddgs.text("Tauri desktop", max_results=3))
        print("Default res:", len(res))
    except Exception as e:
        print("Default error:", e)

    print("\nTrying with region:")
    try:
        res_reg = list(ddgs.text("Tauri desktop", region="wt-wt", max_results=3))
        print("Region res:", len(res_reg))
    except Exception as e:
        print("Region error:", e)

    print("\nTrying news:")
    try:
        res_news = list(ddgs.news("Tauri desktop", max_results=3))
        print("News res:", len(res_news))
    except Exception as e:
        print("News error:", e)
