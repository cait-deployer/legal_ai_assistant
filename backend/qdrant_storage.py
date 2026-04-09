"""
Qdrant storage helper — замінює Supabase documents table для векторного пошуку.
Всі скрапери пишуть сюди, server.py звідси читає.
"""
import os
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, MatchAny,
)

QDRANT_URL      = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = "ukrainian_laws"

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        # localhost — без prefix (прямий доступ всередині сервера)
        # зовнішній URL — з prefix "qdrant" (через Nginx)
        if "localhost" in QDRANT_URL or "127.0.0.1" in QDRANT_URL:
            _client = QdrantClient(url=QDRANT_URL, timeout=30)
        else:
            _client = QdrantClient(url=QDRANT_URL, prefix="qdrant", timeout=30)
    return _client


# ── ІНІЦІАЛІЗАЦІЯ КОЛЕКЦІЇ ─────────────────────────────────────────────────

def init_collection(vector_size: int = 768, force_recreate: bool = False):
    """Створює колекцію, якщо вона ще не існує."""
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME in existing:
        if not force_recreate:
            print(f"✅ Колекція '{COLLECTION_NAME}' вже існує.")
            return
        client.delete_collection(COLLECTION_NAME)
        print(f"🗑️ Стару колекцію '{COLLECTION_NAME}' видалено.")

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
    )
    print(f"✅ Колекцію '{COLLECTION_NAME}' створено (size={vector_size}).")


# ── ЗАПИС ─────────────────────────────────────────────────────────────────

def upload_to_qdrant(text: str, metadata: dict, embedding: list, session_id=None):
    """Зберігає один чанк у Qdrant."""
    payload = {**metadata, "content": text}
    if session_id:
        payload["sync_session_id"] = session_id

    point = PointStruct(
        id=str(uuid.uuid4()),
        vector=embedding,
        payload=payload,
    )
    try:
        get_client().upsert(collection_name=COLLECTION_NAME, points=[point])
    except Exception as e:
        print(f"⚠️ Qdrant upload error: {e}")


# ── ЧИТАННЯ ІСНУЮЧИХ ЗАКОНІВ ───────────────────────────────────────────────

def get_existing_laws_meta() -> dict:
    """
    Повертає {law_id: {"scraped_at": str, "effective_date": str}} — тільки перший чанк.
    effective_date — дата редакції з Ради (dd.mm.yyyy), "" якщо ще не збережена
    (старі записи без поля — безпечно повертають "").
    """
    try:
        result, _ = get_client().scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=Filter(
                must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
            ),
            with_payload=["law_id", "scraped_at", "effective_date"],
            limit=10000,
        )
        return {
            p.payload["law_id"]: {
                "scraped_at": p.payload.get("scraped_at", "1970-01-01T00:00:00"),
                "effective_date": p.payload.get("effective_date", ""),
            }
            for p in result if "law_id" in p.payload
        }
    except Exception as e:
        print(f"⚠️ get_existing_laws_meta error: {e}")
        return {}


def get_existing_law_ids() -> set:
    """Повертає set всіх law_id в Qdrant."""
    return set(get_existing_laws_meta().keys())


# ── ВИДАЛЕННЯ СТАРИХ ЧАНКІВ ────────────────────────────────────────────────

def delete_law_chunks(law_id: str):
    """Видаляє всі чанки конкретного закону з Qdrant."""
    try:
        get_client().delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[FieldCondition(key="law_id", match=MatchValue(value=law_id))]
            ),
        )
        print(f"🗑️ Видалено чанки '{law_id}' з Qdrant.")
    except Exception as e:
        print(f"❌ delete_law_chunks error: {e}")


# ── ПОШУК ────────────────────────────────────────────────────────────────

def search_qdrant(
    query_vector: list,
    top_k: int = 10,
    filter_domains: list | None = None,
    match_threshold: float = 0.4,
) -> list:
    """
    Векторний пошук у Qdrant.
    Повертає список у тому ж форматі, що раніше повертав Supabase match_documents:
      [{"out_content": str, "out_metadata": dict, "similarity": float}]
    """
    qdrant_filter = None
    if filter_domains:
        qdrant_filter = Filter(
            must=[FieldCondition(key="source_domain", match=MatchAny(any=filter_domains))]
        )

    client = get_client()
    try:
        # qdrant-client >= 1.7: query_points; fallback to legacy search
        if hasattr(client, "query_points"):
            response = client.query_points(
                collection_name=COLLECTION_NAME,
                query=query_vector,
                limit=top_k,
                query_filter=qdrant_filter,
                score_threshold=match_threshold,
                with_payload=True,
            )
            points = response.points
        else:
            points = client.search(
                collection_name=COLLECTION_NAME,
                query_vector=query_vector,
                limit=top_k,
                query_filter=qdrant_filter,
                score_threshold=match_threshold,
                with_payload=True,
            )
        return [
            {
                "out_content": r.payload.get("content", ""),
                "out_metadata": {k: v for k, v in r.payload.items() if k != "content"},
                "similarity": r.score,
            }
            for r in points
        ]
    except Exception as e:
        print(f"❌ Qdrant search error: {e}")
        return []
