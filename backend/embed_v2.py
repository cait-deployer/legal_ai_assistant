"""
embed_v2.py — Embedding модуль v2.
Модель: gemini-embedding-001 (3072 dims, GA, Vertex AI).
Ліміт квоти Paid Tier 1: 3000 req/min.
SLEEP_SEC=0.1 → 10 req/s single-thread; 4 workers → 40 req/s = 2400/min (нижче 3000).
"""
import os
import time
import threading

_client = None
_client_lock = threading.Lock()

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMS  = 3072
SLEEP_SEC   = 0.35  # ~170 req/min — well below 3000/min quota, avoids burst 429


def _cfg(key: str) -> str:
    try:
        import settings_cache
        return settings_cache.get(key, "") or ""
    except Exception:
        return ""


def _get_client():
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        from google import genai
        try:
            import settings_cache
            creds = settings_cache.get_credentials()
        except Exception:
            creds = None
        project  = _cfg("vertex_project_id") or _cfg("vertex_project") or os.getenv("VERTEX_PROJECT", "urai-492512")
        location = _cfg("vertex_location") or os.getenv("VERTEX_LOCATION", "us-central1")
        _client  = genai.Client(vertexai=True, project=project, location=location, credentials=creds)
        return _client


def _is_rate_limit(ex: Exception) -> bool:
    msg = str(ex).upper()
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "QUOTA" in msg


def embed_documents(texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Ембедить список текстів. Sequential — batch=1 на Vertex AI."""
    from google.genai.types import EmbedContentConfig
    client = _get_client()
    cfg    = EmbedContentConfig(output_dimensionality=EMBED_DIMS, task_type=task)
    total = len(texts)
    result = []
    for i, text in enumerate(texts):
        hard_fails = 0
        rate_waits = 0
        while True:
            try:
                resp = client.models.embed_content(model=EMBED_MODEL, contents=text, config=cfg)
                result.append(list(resp.embeddings[0].values))
                break
            except Exception as ex:
                if _is_rate_limit(ex):
                    rate_waits += 1
                    wait = min(60 * rate_waits, 300)  # 60s, 120s, 180s … cap at 5min
                    print(f"[embed_v2] 429 rate limit on chunk #{i}/{total}, waiting {wait}s (attempt {rate_waits})…", flush=True)
                    time.sleep(wait)
                else:
                    hard_fails += 1
                    if hard_fails >= 3:
                        raise RuntimeError(f"embed failed after 3 attempts for chunk #{i}: {ex}") from ex
                    time.sleep(2 ** hard_fails)
        if total > 100 and (i + 1) % 50 == 0:
            print(f"[embed_v2] {i + 1}/{total} chunks embedded…", flush=True)
        time.sleep(SLEEP_SEC)
    return result


def embed_query(text: str) -> list[float]:
    """Ембедить один запит для пошуку."""
    return embed_documents([text], task="RETRIEVAL_QUERY")[0]
