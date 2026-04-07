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

def get_existing_laws_meta() -> dict:
    """Отримує всі law_id та дату їхнього скрапінгу з Supabase (тільки початкові чанки)."""
    # Вибираємо тільки метадані, де chunk_index = 0, щоб не вантажити всю базу
    url = f"{SUPABASE_URL}/rest/v1/documents?metadata->>chunk_index=eq.0&select=metadata"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    try:
        r = httpx.get(url, headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            meta_map = {}
            for item in data:
                m = item.get('metadata')
                if m and 'law_id' in m:
                    # Зберігаємо дату скрапінгу
                    meta_map[m['law_id']] = m.get('scraped_at', '1970-01-01T00:00:00')
            return meta_map
    except Exception as e:
        print(f"⚠️ Помилка отримання метаданих: {e}")
    return {}

def delete_old_law_chunks(law_id: str):
    """Повністю видаляє всі чанки закону перед оновленням, щоб уникнути дублів."""
    url = f"{SUPABASE_URL}/rest/v1/documents?metadata->>law_id=eq.{law_id}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    try:
        r = httpx.delete(url, headers=headers, timeout=20)
        if r.status_code in [200, 204]:
            print(f"🗑️ Стару версію {law_id} видалено з бази.")
    except Exception as e:
        print(f"❌ Помилка видалення {law_id}: {e}")

def upload_chunk_to_supabase(text, metadata, embedding, session_id=None):
    """Завантажує один чанк у Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/documents"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    data = {
        "content": text, 
        "metadata": metadata, 
        "embedding": embedding,
        "sync_session_id": session_id
    }
    try:
        httpx.post(url, headers=headers, json=data, timeout=15)
    except Exception as e:
        print(f"⚠️ Помилка завантаження чанка: {e}")

def run_rada_sync(log_callback=None, session_id=None):
    """Головна функція: скрапінг та розумне оновлення бази."""
    log = log_callback or (lambda msg, level="info": print(msg))

    log("=" * 50)
    log("🚀 LIVE SYNC: RADA -> SUPABASE (SMART UPDATE)")
    log("=" * 50)

    # 1. Завантажуємо карту існуючих законів
    existing_meta = get_existing_laws_meta()
    log(f"📋 В базі знайдено {len(existing_meta)} унікальних законів.")

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
        should_download = True
        if law_id in existing_meta:
            # Парсимо дату (обробляємо Z для сумісності з Python)
            last_date_str = existing_meta[law_id].replace('Z', '+00:00')
            last_scraped = datetime.fromisoformat(last_date_str)
            
            # Порівнюємо в UTC, щоб уникнути помилок
            now = datetime.now(timezone.utc) if last_scraped.tzinfo else datetime.now()
            days_passed = (now - last_scraped).days
            
            if days_passed < 7:
                # Закон свіжий, пропускаємо
                should_download = False
            else:
                # Закон застарів — видаляємо старі чанки перед оновленням
                log(f"🔄 Оновлення: {law_id} (вік: {days_passed} дн.)...")
                delete_old_law_chunks(law_id)

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
                    "chunk_index": j
                }
                upload_chunk_to_supabase(chunk_text, metadata, vector, session_id=session_id)
                time.sleep(0.5) # Пауза для стабільності API
            except Exception as e:
                log(f"  ❌ Помилка чанка {j}: {e}", "error")
                time.sleep(2)

        processed_count += 1
        log(f"  ✅ Готово!", "success")
        time.sleep(0.5)

    return {"processed": processed_count}

if __name__ == "__main__":
    run_rada_sync()
    