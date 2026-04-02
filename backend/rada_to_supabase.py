import os
import time
import httpx
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from rada_scanner import (
    get_all_legal_ids,
    get_law_text,
    get_law_status,
    SECTIONS,
    BASE,
)

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL")

embeddings = GoogleGenerativeAIEmbeddings(
    model=EMBEDDING_MODEL,
    google_api_key=GOOGLE_API_KEY
)

text_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=250)

# ПЕРЕВІРКА ЧЕРЕЗ SUPABASE (замість файлу)

def get_existing_law_ids() -> set:
    """Отримує всі унікальні law_id безпосередньо з метаданих бази"""
    print("🔍 Синхронізація з хмарою: отримую список завантажених законів...")
    # Використовуємо .select(metadata) і фільтруємо law_id
    url = f"{SUPABASE_URL}/rest/v1/documents?select=metadata"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    try:
        r = httpx.get(url, headers=headers, timeout=20)
        if r.status_code == 200:
            data = r.json()
            # Витягуємо law_id з JSONB поля metadata
            ids = {item['metadata']['law_id'] for item in data if item.get('metadata') and 'law_id' in item['metadata']}
            print(f"✅ База знає про {len(ids)} законів.")
            return ids
    except Exception as e:
        print(f"⚠️ Помилка доступу до бази: {e}")
    return set()

def upload_chunk_to_supabase(text, metadata, embedding):
    url = f"{SUPABASE_URL}/rest/v1/documents"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    data = {"content": text, "metadata": metadata, "embedding": embedding}
    r = httpx.post(url, headers=headers, json=data)
    if r.status_code not in [200, 201]:
        print(f"   ❌ ПОМИЛКА SUPABASE ({r.status_code}): {r.text}")

# ─── RUN SYNC ──────────────────────────────────────────────────────────────────

def run_sync():
    print("=" * 60)
    print("🚀 LIVE SYNC: RADA -> SUPABASE (No Index File Mode)")
    print("=" * 60)

    # Отримуємо ID прямо з бази
    downloaded_ids = get_existing_law_ids()

    # Скануємо Раду
    all_laws = get_all_legal_ids()
    
    # Фільтруємо нові
    new_laws = [l for l in all_laws if l["id"] not in downloaded_ids]

    if not new_laws:
        print("\n✅ Нових документів не знайдено. Все актуально!")
        return

    print(f"\nДо завантаження: {len(new_laws)} нових законів.")

    for i, law in enumerate(new_laws, 1):
        law_id = law["id"]
        law_title = law["title"]
        category = law["category"]
        law_url = f"{BASE}/laws/show/{law_id}"

        print(f"\n[{i}/{len(new_laws)}] 📥 Обробка: {law_title}")

        # Отримуємо текст
        text = get_law_text(law_id)
        if not text: continue

        # Отримуємо статус (Чинний/Ні)
        status = get_law_status(law_id)
        
        chunks = text_splitter.split_text(text)
        print(f"   ✂️  {len(chunks)} чанків | Статус: {status}")

        for j, chunk_text in enumerate(chunks):
            try:
                vector = embeddings.embed_query(chunk_text)
                metadata = {
                    "source": law_title,
                    "law_id": law_id,
                    "category": category,
                    "status": status,      # Твій новий статус
                    "law_url": law_url,    # Твій новий лінк
                    "chunk_index": j
                }
                upload_chunk_to_supabase(chunk_text, metadata, vector)
                time.sleep(0.7) # Пауза для лімітів Gemini
            except Exception as e:
                print(f"   ❌ Помилка: {e}")
                time.sleep(5)

        print(f"   ✅ Готово!")
        time.sleep(1)

if __name__ == "__main__":
    run_sync()