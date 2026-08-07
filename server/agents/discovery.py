import asyncio
import os
import re
import difflib
import random
import sys
import subprocess
from typing import List, Optional, Dict, Any
import httpx
import html2text
from schemas import SearchCandidate, ScrapedSource, ResearchOutput

try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except ImportError:
    BM25_AVAILABLE = False

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    CRAWL4AI_AVAILABLE = True
except ImportError:
    CRAWL4AI_AVAILABLE = False

try:
    from duckduckgo_search import DDGS
    DUCKDUCKGO_AVAILABLE = True
except ImportError:
    DUCKDUCKGO_AVAILABLE = False

# Max concurrent scrape requests
MAX_SCRAPE_CONCURRENCY = 4

def clean_html_noise(text: str) -> str:
    """Stage 1 Pre-processing: Strips scripts, styles, noscript, nav, header, footer, and inline HTML tags."""
    if not text:
        return ""
    text = re.sub(r'<script.*?>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style.*?>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<noscript.*?>.*?</noscript>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<nav.*?>.*?</nav>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<header.*?>.*?</header>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<footer.*?>.*?</footer>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'[ \t]+', ' ', text).strip()

def calculate_word_jaccard(text1: str, text2: str) -> float:
    """Calculates word-level Jaccard similarity between two text snippets."""
    words1 = set(re.findall(r'\w+', text1.lower()))
    words2 = set(re.findall(r'\w+', text2.lower()))
    if not words1 or not words2:
        return 0.0
    intersection = len(words1 & words2)
    union = len(words1 | words2)
    return intersection / union if union > 0 else 0.0

class WebDiscoveryAgent:
    def __init__(self):
        self.semaphore = asyncio.Semaphore(MAX_SCRAPE_CONCURRENCY)

    async def search_tavily(self, query: str, api_key: str, max_results: int = 5) -> List[SearchCandidate]:
        """Queries Tavily AI Search API for ranked candidate URLs."""
        if not api_key:
            return []
        
        url = "https://api.tavily.com/search"
        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": max_results
        }
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    results = []
                    for item in data.get("results", []):
                        results.append(SearchCandidate(
                            url=item.get("url", ""),
                            title=item.get("title", ""),
                            snippet=item.get("content", ""),
                            score=item.get("score")
                        ))
                    return results
                else:
                    print(f"[WebDiscoveryAgent] Tavily search error {res.status_code}: {res.text}")
            except Exception as e:
                print(f"[WebDiscoveryAgent] Tavily search exception: {e}")
        return []

    async def search_duckduckgo(self, query: str, max_results: int = 5) -> List[SearchCandidate]:
        """Queries DuckDuckGo Search anonymously (no API key required)."""
        if not DUCKDUCKGO_AVAILABLE:
            print("[WebDiscoveryAgent] duckduckgo-search package not available.")
            return []
        try:
            with DDGS() as ddgs:
                results = []
                for r in ddgs.text(query, max_results=max_results):
                    results.append(SearchCandidate(
                        url=r.get("href", ""),
                        title=r.get("title", ""),
                        snippet=r.get("body", ""),
                        score=None
                    ))
                return results
        except Exception as e:
            print(f"[WebDiscoveryAgent] DuckDuckGo search exception: {e}")
        return []

    async def scrape_tier1_httpx(self, url: str) -> Optional[str]:
        """Tier 1: Fetch raw HTML using HTTPX, convert clean text to markdown via html2text."""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    h = html2text.HTML2Text()
                    h.ignore_links = False
                    h.ignore_images = True
                    h.body_width = 0
                    return h.handle(res.text)
        except Exception as e:
            print(f"[WebDiscoveryAgent] Tier 1 fetch error for {url}: {e}")
        return None

    async def scrape_tier2_firecrawl(self, url: str, firecrawl_key: str) -> Optional[str]:
        """Tier 2: Scrape JS-rendered page via Firecrawl API."""
        if not firecrawl_key:
            return None
        target_url = "https://api.firecrawl.dev/v1/scrape"
        headers = {
            "Authorization": f"Bearer {firecrawl_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "url": url,
            "formats": ["markdown"]
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(target_url, json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    if data.get("success") and "data" in data:
                        return data["data"].get("markdown")
                else:
                    print(f"[WebDiscoveryAgent] Tier 2 Firecrawl error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[WebDiscoveryAgent] Tier 2 Firecrawl exception for {url}: {e}")
        return None

    async def install_playwright_browsers(self) -> bool:
        """Downloads Chromium browser binaries dynamically on-demand."""
        print("[WebDiscoveryAgent] Playwright browser not found. Downloading Chromium binary dynamically...")
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "playwright", "install", "chromium",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            if process.returncode == 0:
                print("[WebDiscoveryAgent] Playwright Chromium browser installed successfully!")
                return True
            else:
                print(f"[WebDiscoveryAgent] Playwright browser install failed (code {process.returncode}): {stderr.decode()}")
        except Exception as e:
            print(f"[WebDiscoveryAgent] Exception installing Playwright browser: {e}")
        return False

    async def scrape_url_tiered(
        self,
        url: str,
        scrape_provider: str = "crawl4ai",
        firecrawl_key: Optional[str] = None
    ) -> ScrapedSource:
        """Runs tiered scraping (HTTPX -> Crawl4AI -> Firecrawl) depending on configuration."""
        async with self.semaphore:
            # 1. Firecrawl API option
            if scrape_provider == "firecrawl" and firecrawl_key:
                print(f"[WebDiscoveryAgent] Scraping via Firecrawl API: {url}")
                content = await self.scrape_tier2_firecrawl(url, firecrawl_key)
                if content:
                    return ScrapedSource(url=url, title=url, markdown_content=content, success=True)
                print(f"[WebDiscoveryAgent] Firecrawl failed. Falling back to static HTTPX for {url}")

            # 2. Local Crawl4AI option
            if scrape_provider == "crawl4ai" and CRAWL4AI_AVAILABLE:
                print(f"[WebDiscoveryAgent] Scraping via local Crawl4AI: {url}")
                browser_config = BrowserConfig(headless=True, verbose=False)
                run_config = CrawlerRunConfig(
                    cache_mode=CacheMode.BYPASS,
                    check_robots_txt=False,
                    word_count_threshold=10
                )
                try:
                    async with AsyncWebCrawler(config=browser_config) as crawler:
                        res = await crawler.arun(url=url, config=run_config)
                        if res.success:
                            md = res.markdown.raw_markdown if hasattr(res.markdown, "raw_markdown") else str(res.markdown)
                            clean_md = clean_html_noise(md or "")
                            return ScrapedSource(url=url, title=url, markdown_content=clean_md, success=True)
                except Exception as e:
                    err_msg = str(e)
                    if "Executable doesn't exist" in err_msg or "playwright install" in err_msg.lower():
                        # Trigger dynamic on-demand download of browsers
                        success = await self.install_playwright_browsers()
                        if success:
                            try:
                                async with AsyncWebCrawler(config=browser_config) as crawler:
                                    res = await crawler.arun(url=url, config=run_config)
                                    if res.success:
                                        md = res.markdown.raw_markdown if hasattr(res.markdown, "raw_markdown") else str(res.markdown)
                                        clean_md = clean_html_noise(md or "")
                                        return ScrapedSource(url=url, title=url, markdown_content=clean_md, success=True)
                            except Exception as retry_err:
                                print(f"[WebDiscoveryAgent] Crawl4AI retry failed: {retry_err}")
                    else:
                        print(f"[WebDiscoveryAgent] Crawl4AI error: {e}")
                print(f"[WebDiscoveryAgent] Crawl4AI failed or unavailable. Falling back to static HTTPX for {url}")

            # 3. Default static fallback
            print(f"[WebDiscoveryAgent] Scraping via static parser (HTTPX + html2text): {url}")
            content = await self.scrape_tier1_httpx(url)
            if content:
                return ScrapedSource(url=url, title=url, markdown_content=content, success=True)
            
            return ScrapedSource(
                url=url,
                title=url,
                markdown_content="",
                success=False,
                error_message="All scraping tiers failed or no API key / browser available."
            )

    async def fetch_sitemap_urls(self, sitemap_url: str, max_urls: int = 10) -> List[str]:
        """Fetches and parses a sitemap.xml to extract nested page URLs."""
        discovered_urls = []
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            try:
                res = await client.get(sitemap_url, headers={"User-Agent": "Mozilla/5.0 (VaultAgent/1.0)"})
                if res.status_code == 200:
                    urls = re.findall(r'<loc>(.*?)</loc>', res.text)
                    for u in urls:
                        u_clean = u.strip()
                        if u_clean and not u_clean.endswith(".xml") and u_clean not in discovered_urls:
                            discovered_urls.append(u_clean)
                            if len(discovered_urls) >= max_urls:
                                break
            except Exception as e:
                print(f"[WebDiscoveryAgent] Sitemap fetch error for {sitemap_url}: {e}")
        return discovered_urls

    async def scrape_urls_parallel(
        self,
        urls: List[str],
        scrape_provider: str = "crawl4ai",
        firecrawl_key: Optional[str] = None
    ) -> List[ScrapedSource]:
        """Scrapes multiple URLs in parallel using tiered scraping logic."""
        if not urls:
            return []
        tasks = [self.scrape_url_tiered(url, scrape_provider, firecrawl_key) for url in urls]
        return await asyncio.gather(*tasks)

    # =========================================================================
    # STAGE 1: HTML Noise Pre-Stripping & 90-95% Fuzzy Deduplication
    # =========================================================================
    def stage1_fuzzy_deduplicate_paragraphs(
        self,
        sources: List[ScrapedSource],
        similarity_threshold: float = 0.90
    ) -> List[Dict[str, Any]]:
        """Pre-strips HTML noise and removes exact & 90-95% near-duplicate paragraphs across all scraped pages."""
        kept_paragraphs: List[Dict[str, Any]] = []
        seen_hashes = set()
        seen_samples: List[str] = []

        for src in sources:
            if not src.success or not src.markdown_content.strip():
                continue
            
            clean_text = clean_html_noise(src.markdown_content)
            paragraphs = [p.strip() for p in clean_text.split("\n\n") if len(p.strip()) > 30]

            for p in paragraphs:
                # 1. Exact SHA-256 Hash check
                p_hash = hash(p)
                if p_hash in seen_hashes:
                    continue

                # 2. Fuzzy 90-95% Jaccard Similarity check
                is_near_duplicate = False
                for existing_p in seen_samples[-100:]: # Check against recent pool
                    jaccard_sim = calculate_word_jaccard(p, existing_p)
                    if jaccard_sim >= similarity_threshold:
                        is_near_duplicate = True
                        break
                    if jaccard_sim >= 0.70: # Double check with difflib if moderately close
                        seq_ratio = difflib.SequenceMatcher(None, p[:200], existing_p[:200]).ratio()
                        if seq_ratio >= similarity_threshold:
                            is_near_duplicate = True
                            break

                if not is_near_duplicate:
                    seen_hashes.add(p_hash)
                    seen_samples.append(p)
                    kept_paragraphs.append({
                        "url": src.url,
                        "title": src.title,
                        "content": p
                    })

        return kept_paragraphs

    # =========================================================================
    # STAGE 2: Chunking & Similarity Ranking (Embeddings or BM25)
    # =========================================================================
    async def stage2_rank_chunks(
        self,
        paragraphs: List[Dict[str, Any]],
        topic: str,
        top_k: int = 20,
        gemini_key: Optional[str] = None,
        openrouter_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Slices clean paragraphs into logical chunks and selects top-K relevant chunks using embeddings or BM25."""
        if not paragraphs:
            return []

        # Chunk paragraphs into ~600-1000 char blocks
        chunks: List[Dict[str, Any]] = []
        for item in paragraphs:
            text = item["content"]
            if len(text) <= 1000:
                chunks.append(item)
            else:
                sub_parts = [text[i:i+800] for i in range(0, len(text), 800)]
                for part in sub_parts:
                    chunks.append({
                        "url": item["url"],
                        "title": item["title"],
                        "content": part
                      })

        # Try semantic ranking first
        if gemini_key or openrouter_key:
            try:
                from embeddings import get_embedding, cosine_similarity
                topic_vec = await get_embedding(topic, gemini_key=gemini_key, openrouter_key=openrouter_key)
                
                if any(val != 0.0 for val in topic_vec):
                    scored = []
                    # Generate embeddings in parallel batches to prevent rate limits
                    semaphore = asyncio.Semaphore(5)
                    async def score_chunk(c):
                        async with semaphore:
                            c_vec = await get_embedding(c["content"], gemini_key=gemini_key, openrouter_key=openrouter_key)
                            sim = cosine_similarity(topic_vec, c_vec)
                            return (sim, c)
                    
                    tasks = [score_chunk(c) for c in chunks]
                    results = await asyncio.gather(*tasks)
                    results.sort(key=lambda x: x[0], reverse=True)
                    return [item[1] for item in results[:top_k]]
            except Exception as e:
                print(f"[WebDiscoveryAgent] Semantic ranking exception, falling back to BM25: {e}")

        # BM25 Fallback
        if not BM25_AVAILABLE:
            return chunks[:top_k]

        corpus_tokens = [re.findall(r'\w+', c["content"].lower()) for c in chunks]
        topic_tokens = re.findall(r'\w+', topic.lower())

        if not corpus_tokens or not topic_tokens:
            return chunks[:top_k]

        bm25 = BM25Okapi(corpus_tokens)
        scores = bm25.get_scores(topic_tokens)

        scored_chunks = list(zip(chunks, scores))
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        return [c[0] for c in scored_chunks[:top_k]]

    # =========================================================================
    # STAGE 3: Parallel Map-Pass Fact Extraction (Cheap Model Pass)
    # =========================================================================
    async def stage3_extract_facts_map_pass(
        self,
        top_chunks: List[Dict[str, Any]],
        topic: str,
        openrouter_key: Optional[str] = None,
        openrouter_model: Optional[str] = None,
        gemini_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Runs parallel map calls on top chunks using OpenRouter or Gemini Flash to extract structured facts."""
        if not top_chunks:
            return []

        resolved_or_key = openrouter_key or os.getenv("OPENROUTER_API_KEY")

        # If no LLM key available, pass top chunks directly
        if not resolved_or_key and not gemini_key:
            return top_chunks

        model_name = openrouter_model or "google/gemini-2.5-flash"
        
        # Free models on OpenRouter have very strict concurrency limits.
        # Restrict concurrency to 1 and stagger requests to avoid 429s entirely.
        is_free_model = "free" in model_name.lower()
        concurrency_limit = 1 if is_free_model else 3
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def map_worker(chunk: Dict[str, Any], idx: int) -> Dict[str, Any]:
            # Stagger task startup to prevent instant rate limit spikes
            stagger_time = 1.0 if is_free_model else 0.2
            await asyncio.sleep(idx * stagger_time)
            
            async with semaphore:
                prompt = (
                    f"Topic: {topic}\n"
                    f"Source URL: {chunk['url']}\n\n"
                    f"Content:\n{chunk['content']}\n\n"
                    "Task: Extract only direct factual claims, key definitions, statistics, and concrete code/algorithms "
                    "relevant to the topic. Output as concise bullet points. If nothing is relevant, output 'NONE'."
                )
                
                extracted_text = ""
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        async with httpx.AsyncClient(timeout=20.0) as client:
                            if resolved_or_key:
                                headers = {
                                    "Authorization": f"Bearer {resolved_or_key}",
                                    "Content-Type": "application/json"
                                }
                                body = {
                                    "model": model_name,
                                    "messages": [{"role": "user", "content": prompt}],
                                    "temperature": 0.2,
                                    "max_tokens": 1000
                                }
                                res = await client.post("https://openrouter.ai/api/v1/chat/completions", json=body, headers=headers)
                                if res.status_code == 200:
                                    data = res.json()
                                    extracted_text = data["choices"][0]["message"]["content"].strip()
                                    break
                                elif res.status_code == 429:
                                    backoff = (2 ** attempt) + random.uniform(0.1, 1.0)
                                    print(f"[WebDiscoveryAgent] OpenRouter rate limit (429) hit. Retrying in {backoff:.2f}s...")
                                    await asyncio.sleep(backoff)
                                else:
                                    print(f"[WebDiscoveryAgent] OpenRouter API error {res.status_code}: {res.text[:150]}")
                                    break
                            elif gemini_key:
                                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                                body = {"contents": [{"parts": [{"text": prompt}]}]}
                                res = await client.post(url, json=body)
                                if res.status_code == 200:
                                    data = res.json()
                                    extracted_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                                    break
                                elif res.status_code == 429:
                                    backoff = (2 ** attempt) + random.uniform(0.1, 1.0)
                                    await asyncio.sleep(backoff)
                                else:
                                    break
                    except Exception as e:
                        print(f"[WebDiscoveryAgent] Attempt {attempt+1} map pass error for {chunk['url']}: {e}")
                        await asyncio.sleep(1.0)

                if extracted_text and "NONE" not in extracted_text.upper():
                    return {
                        "url": chunk["url"],
                        "title": chunk["title"],
                        "content": extracted_text
                    }
                return {
                    "url": chunk["url"],
                    "title": chunk["title"],
                    "content": chunk["content"]
                }

        tasks = [map_worker(c, idx) for idx, c in enumerate(top_chunks)]
        results = await asyncio.gather(*tasks)
        return [r for r in results if r]

    # =========================================================================
    # STAGE 4: Synthesis Payload Assembly & Strict Token Budgeting
    # =========================================================================
    def stage4_assemble_budgeted_payload(
        self,
        extracted_facts: List[Dict[str, Any]],
        max_chars: int = 24000 # ~6,000 - 8,000 tokens
    ) -> str:
        """Consolidates extracted facts into a structured, token-budgeted Markdown payload."""
        grouped: Dict[str, List[str]] = {}
        for item in extracted_facts:
            url = item["url"]
            grouped.setdefault(url, []).append(item["content"])

        payload_blocks = []
        current_length = 0

        for url, facts in grouped.items():
            header = f"#### From Source: [{url}]({url})\n"
            content_block = "\n".join(facts) + "\n\n"
            full_block = header + content_block

            if current_length + len(full_block) > max_chars:
                # Truncate to fit exact character budget
                remaining = max_chars - current_length
                if remaining > 100:
                    payload_blocks.append(full_block[:remaining] + "\n...[Truncated for token budget]\n")
                break

            payload_blocks.append(full_block)
            current_length += len(full_block)

        return "\n---\n".join(payload_blocks)

    async def execute_research(
        self,
        topic: str,
        user_urls: Optional[List[str]] = None,
        search_provider: str = "duckduckgo",
        scrape_provider: str = "crawl4ai",
        tavily_key: Optional[str] = None,
        openrouter_key: Optional[str] = None,
        openrouter_model: Optional[str] = None,
        gemini_key: Optional[str] = None,
        firecrawl_key: Optional[str] = None,
        progress_callback = None
    ) -> ResearchOutput:
        urls_to_scrape = []

        if user_urls and len(user_urls) > 0:
            expanded_urls = []
            for u in user_urls:
                if u.endswith(".xml") or "sitemap" in u.lower():
                    if progress_callback:
                        await progress_callback(f"Extracting nested URLs from sitemap {u}...", 15)
                    sitemap_nested = await self.fetch_sitemap_urls(u)
                    expanded_urls.extend(sitemap_nested)
                else:
                    expanded_urls.append(u)
            urls_to_scrape = expanded_urls if expanded_urls else list(user_urls)
            if progress_callback:
                await progress_callback(f"Resolved {len(urls_to_scrape)} reference URLs to crawl.", 25)
        else:
            # Dynamic web search depending on provider
            if search_provider == "tavily" and tavily_key:
                if progress_callback:
                    await progress_callback(f"Searching web for '{topic}' via Tavily...", 20)
                candidates = await self.search_tavily(topic, tavily_key, max_results=5)
                urls_to_scrape = [c.url for c in candidates]
            else:
                # Default to DuckDuckGo search
                if progress_callback:
                    await progress_callback(f"Searching web for '{topic}' via DuckDuckGo...", 20)
                candidates = await self.search_duckduckgo(topic, max_results=5)
                urls_to_scrape = [c.url for c in candidates]

            if progress_callback:
                await progress_callback(f"Found {len(urls_to_scrape)} candidate web sources.", 35)

        if not urls_to_scrape:
            return ResearchOutput(
                topic=topic,
                sources_attempted=0,
                sources_succeeded=0,
                sources=[],
                combined_deduped_context=""
            )

        if progress_callback:
            await progress_callback(f"Parallel crawling {len(urls_to_scrape)} web pages via {scrape_provider}...", 40)

        # Scrape all pages concurrently
        scraped_sources = await self.scrape_urls_parallel(urls_to_scrape, scrape_provider, firecrawl_key)
        successful_sources = [s for s in scraped_sources if s.success]

        # ---------------------------------------------------------------------
        # STAGE 1: HTML Noise Pre-Stripping & 90-95% Fuzzy Paragraph Deduplication
        # ---------------------------------------------------------------------
        if progress_callback:
            await progress_callback("Stage 1: Pre-stripping HTML noise & fuzzy deduplicating paragraphs (90-95% match)...", 55)
        
        stage1_paragraphs = self.stage1_fuzzy_deduplicate_paragraphs(scraped_sources, similarity_threshold=0.90)

        # ---------------------------------------------------------------------
        # STAGE 2: Relevance Chunk Filtering (Embeddings or BM25)
        # ---------------------------------------------------------------------
        if progress_callback:
            await progress_callback("Stage 2: Ranking Top-20 relevant chunks...", 70)
        
        stage2_top_chunks = await self.stage2_rank_chunks(
            stage1_paragraphs,
            topic=topic,
            top_k=20,
            gemini_key=gemini_key,
            openrouter_key=openrouter_key
        )

        # ---------------------------------------------------------------------
        # STAGE 3: Parallel Map-Pass Fact Extraction (Cheap Model Pass)
        # ---------------------------------------------------------------------
        if progress_callback:
            await progress_callback("Stage 3: Running parallel Map-pass fact extraction...", 85)
        
        stage3_facts = await self.stage3_extract_facts_map_pass(
            top_chunks=stage2_top_chunks,
            topic=topic,
            openrouter_key=openrouter_key,
            openrouter_model=openrouter_model,
            gemini_key=gemini_key
        )

        # ---------------------------------------------------------------------
        # STAGE 4: Synthesis Payload Assembly & Strict Token Budgeting
        # ---------------------------------------------------------------------
        if progress_callback:
            await progress_callback("Stage 4: Assembling token-budgeted research context payload...", 95)
        
        final_context = self.stage4_assemble_budgeted_payload(stage3_facts, max_chars=24000)

        return ResearchOutput(
            topic=topic,
            sources_attempted=len(urls_to_scrape),
            sources_succeeded=len(successful_sources),
            sources=scraped_sources,
            combined_deduped_context=final_context
        )

discovery_agent = WebDiscoveryAgent()
