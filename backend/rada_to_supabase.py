import os
from dotenv import load_dotenv
from langchain_google_vertexai import VertexAIEmbeddings
import settings_cache

from rada_scanner import (
    get_all_legal_ids,
    get_law_text,
    get_law_metadata,
    BASE,
)

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def _get_embeddings() -> VertexAIEmbeddings:
    """Vertex AI embeddings з credentials із settings_cache."""
    import vertexai
    creds    = settings_cache.get_credentials()
    project  = settings_cache.get_vertex_project()
    location = settings_cache.get_vertex_location()
    model    = settings_cache.get("embedding_model", "text-embedding-004")
    vertexai.init(project=project, location=location, credentials=creds)
    return VertexAIEmbeddings(model_name=model, credentials=creds, project=project)


class _LazyEmbeddings:
    """Proxy: при кожному виклику бере свіжі credentials з кешу."""
    def embed_query(self, text: str) -> list:
        return _get_embeddings().embed_query(text)
    def embed_documents(self, texts: list) -> list:
        return _get_embeddings().embed_documents(texts)


embeddings = _LazyEmbeddings()


# ── Імпорт нового мульти-колекційного API ─────────────────────────────────────
from qdrant_storage import (
    upload_to_qdrant,
    get_all_existing_laws_meta,
    get_existing_law_ids,
    delete_law_chunks,
    get_collection_for_category,
)


# ── Аліаси для supreme_scanner (зворотна сумісність) ──────────────────────────
def upload_chunk_to_supabase(text: str, metadata: dict, embedding: list,
                              session_id: str | None = None,
                              collection_name: str = "laws_supreme"):
    """Supreme scanner використовує цей аліас — завжди laws_supreme."""
    upload_to_qdrant(text, metadata, embedding, collection_name, session_id=session_id)


def delete_old_law_chunks(law_id: str, collection_name: str) -> None:
    delete_law_chunks(law_id, collection_name)
