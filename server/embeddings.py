import math
import httpx
from typing import List, Optional

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Computes cosine similarity between two vector lists."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_v1 = math.sqrt(sum(a * a for a in v1))
    norm_v2 = math.sqrt(sum(b * b for b in v2))
    if norm_v1 == 0 or norm_v2 == 0:
        return 0.0
    return dot_product / (norm_v1 * norm_v2)

async def get_embedding(
    text: str,
    gemini_key: Optional[str] = None,
    openrouter_key: Optional[str] = None
) -> List[float]:
    """Generates embedding vector using OpenRouter or Gemini embeddings, or returns zero-vector fallback."""
    # Determine fallback dimension
    dim = 1536 if openrouter_key else 768

    if openrouter_key:
        try:
            url = "https://openrouter.ai/api/v1/embeddings"
            headers = {
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "openai/text-embedding-3-small",
                "input": text
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(url, json=payload, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    return data["data"][0]["embedding"]
                else:
                    print(f"[Embeddings] OpenRouter embedding error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[Embeddings] Exception generating OpenRouter embedding: {e}")

    elif gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={gemini_key}"
            payload = {
                "model": "models/gemini-embedding-001",
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": 768
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    return data["embedding"]["values"]
                else:
                    print(f"[Embeddings] Gemini embedding error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[Embeddings] Exception generating Gemini embedding: {e}")

    # Fallback zero-vector
    return [0.0] * dim
