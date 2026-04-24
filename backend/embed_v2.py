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
SLEEP_SEC   = 0.1


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
        project  = _cfg("vertex_project_id") or _cfg("vertex_project") or os.getenv("VERTEX_PROJECT", "urai-492512")
        location = _cfg("vertex_location") or os.getenv("VERTEX_LOCATION", "us-central1")
        _client  = genai.Client(vertexai=True, project=project, location=location)
        return _client


def embed_documents(texts: list[str], task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Ембедить список текстів. Sequential — batch=1 на Vertex AI."""
    from google.genai.types import EmbedContentConfig
    client = _get_client()
    cfg    = EmbedContentConfig(output_dimensionality=EMBED_DIMS, task_type=task)
    result = []
    for i, text in enumerate(texts):
        for attempt in range(3):
            try:
                resp = client.models.embed_content(model=EMBED_MODEL, contents=text, config=cfg)
                result.append(list(resp.embeddings[0].values))
                break
            except Exception as ex:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    raise RuntimeError(f"embed failed after 3 attempts for chunk #{i}: {ex}") from ex
        time.sleep(SLEEP_SEC)
    return result


def embed_query(text: str) -> list[float]:
    """Ембедить один запит для пошуку."""
    return embed_documents([text], task="RETRIEVAL_QUERY")[0]
