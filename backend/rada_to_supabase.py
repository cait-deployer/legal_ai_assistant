import os
import time
import httpx
import re
from dotenv import load_dotenv
from langchain_text_splitters import MarkdownTextSplitter
from langchain_google_vertexai import VertexAIEmbeddings
from datetime import datetime, timezone
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

text_splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)

from qdrant_storage import (
    upload_to_qdrant,
    get_existing_laws_meta,
    delete_law_chunks,
)

# Аліаси для сумісності зі старим кодом (supreme_scanner та ін.)
def upload_chunk_to_supabase(text, metadata, embedding, session_id=None):
    upload_to_qdrant(text, metadata, embedding, session_id=session_id)

def get_existing_law_ids() -> set:
    return set(get_existing_laws_meta().keys())

def delete_old_law_chunks(law_id: str):
    delete_law_chunks(law_id)

def run_rada_sync(log_callback=None, session_id=None):
    """Головна функція: скрапінг та розумне оновлення бази."""
    log = log_callback or (lambda msg, level="info": print(msg))

    log("=" * 50)
    log("🚀 LIVE SYNC: RADA -> QDRANT (SMART UPDATE)")
    log("=" * 50)

    # 1. Завантажуємо карту існуючих законів (тепер з Qdrant)
    existing_meta = get_existing_laws_meta()
    log(f"📋 В Qdrant знайдено {len(existing_meta)} унікальних законів.")

    # 2. Скануємо Раду на наявність усіх ID
    log("📡 Сканування розділів Ради...")
    all_laws = get_all_legal_ids()
    processed_count = 0

    for i, law in enumerate(all_laws, 1):
        law_id = law["id"]
        law_title = law["title"]
        category = law["category"]
        law_url = f"{BASE}/laws/show/{law_id}"
        
        # 3. ЛОГІКА ДЕДУПЛІКАЦІЇ ТА ОНОВЛЕННЯ
        # Пріоритет: порівняння дати редакції з Ради (list_date) зі збереженою.
        # Fallback для старих записів без дати: перевірка по віку scraped_at.
        should_download = True
        if law_id in existing_meta:
            meta = existing_meta[law_id]
            stored_date = meta.get("effective_date", "")
            list_date = law.get("list_date", "")

            if stored_date and list_date:
                if stored_date == list_date:
                    should_download = False
                else:
                    log(f"🔄 Нова редакція {law_id}: {stored_date} → {list_date}")
                    delete_old_law_chunks(law_id)
            else:
                try:
                    last_date_str = meta.get("scraped_at", "").replace("Z", "+00:00")
                    last_scraped = datetime.fromisoformat(last_date_str)
                    now = datetime.now(timezone.utc) if last_scraped.tzinfo else datetime.now()
                    days_passed = (now - last_scraped).days
                    if days_passed < 7:
                        should_download = False
                    else:
                        log(f"🔄 Оновлення: {law_id} (вік: {days_passed} дн., дата редакції невідома)")
                        delete_old_law_chunks(law_id)
                except Exception:
                    pass

        if not should_download:
            continue

        log(f"[{i}/{len(all_laws)}] Обробка: {law_title}")

        # 4. ЗАВАНТАЖЕННЯ ТЕКСТУ ТА МЕТАДАНИХ
        text = get_law_text(law_id)
        if not text:
            log(f"  ⚠️ Пропущено — порожній текст.", "warning")
            continue

        law_meta = get_law_metadata(law_id)
        status = law_meta["status"]
        chunks = text_splitter.split_text(text)
        log(f"  ✂️ {len(chunks)} чанків | Статус: {status}")

        # 5. ВЕКТОРІЗАЦІЯ ТА ЗАВАНТАЖЕННЯ
        scraped_at = datetime.now(timezone.utc).isoformat()
        for j, chunk_text in enumerate(chunks):
            try:
                vector = embeddings.embed_query(chunk_text)
                metadata = {
                    "source": law_title,
                    "law_id": law_id,
                    "category": category,
                    "status": status,
                    "law_url": law_url,
                    "source_domain": "zakon.rada.gov.ua",
                    "scraped_at": scraped_at,
                    "effective_date": law.get("list_date", ""),
                    "chunk_index": j
                }
                upload_to_qdrant(chunk_text, metadata, vector, session_id=session_id)
                time.sleep(0.7) # Пауза для стабільності API
            except Exception as e:
                log(f"  ❌ Помилка чанка {j}: {e}", "error")
                time.sleep(2)

        processed_count += 1
        log(f"  ✅ Готово!", "success")
        time.sleep(0.5)

    return {"processed": processed_count}

if __name__ == "__main__":
    run_rada_sync()
    