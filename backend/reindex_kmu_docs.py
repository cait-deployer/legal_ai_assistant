"""
reindex_kmu_docs.py — Переіндексує конкретні KMU документи з title-prefix чанками.
Запуск: python reindex_kmu_docs.py
"""
import sys
from datetime import datetime, timezone

from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, delete_law_chunks
from rada_scanner import get_law_text, get_law_metadata, BASE

COLLECTION = "laws_kmu"
text_splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)

DOCS_TO_REINDEX = [
    {"law_id": "663-99-%D0%BF",  "title": "Постанова КМУ від 23.04.1999 №663 «Про норми відшкодування витрат на відрядження в межах України та за кордон»"},
    {"law_id": "98-2011-%D0%BF", "title": "Постанова КМУ від 02.02.2011 №98 «Про суми та склад витрат на відрядження державних службовців»"},
]


def reindex_doc(law_id: str, title: str) -> None:
    stored_id = f"kmu_{law_id}"
    print(f"\n{'='*60}")
    print(f"🔄 Переіндексація: {stored_id}")
    print(f"   Заголовок: {title[:80]}")

    text = get_law_text(law_id)
    if not text or len(text) < 100:
        print(f"❌ Текст не знайдено або занадто короткий")
        return

    print(f"📄 Текст отримано: {len(text)} символів")

    meta = get_law_metadata(law_id)
    law_url = f"{BASE}/laws/show/{law_id}"
    scraped_at = datetime.now(timezone.utc).isoformat()

    # Title-prefix: додаємо заголовок до кожного чанку щоб embedding знав контекст
    chunks = text_splitter.split_text(text)
    prefixed_chunks = [f"{title}\n\n{chunk}" for chunk in chunks]
    print(f"📦 Чанків: {len(chunks)}")

    # Embed
    vectors = []
    try:
        for b in range(0, len(prefixed_chunks), 5):
            vectors.extend(embeddings.embed_documents(prefixed_chunks[b:b+5]))
    except Exception as e:
        print(f"⚠️  Batch embed failed: {e}, fallback to one-by-one")
        for pc in prefixed_chunks:
            try:    vectors.append(embeddings.embed_query(pc))
            except: vectors.append(None)

    # Видаляємо старі чанки
    print(f"🗑️  Видаляємо старі чанки {stored_id}...")
    delete_law_chunks(stored_id, COLLECTION)

    # Завантажуємо нові (зберігаємо оригінальний chunk без prefix щоб відповідь була читабельна)
    uploaded = 0
    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        if vector is None:
            continue
        upload_to_qdrant(
            chunk_text,
            {
                "source":        title,
                "law_id":        stored_id,
                "doc_type":      "Постанова КМУ",
                "category":      "Постанова КМУ",
                "law_url":       law_url,
                "source_domain": "zakon.rada.gov.ua",
                "status":        meta.get("status", "Чинний"),
                "doc_number":    meta.get("doc_number", ""),
                "date_adopted":  meta.get("date_adopted", ""),
                "scraped_at":    scraped_at,
                "chunk_index":   i,
            },
            vector,
            collection_name=COLLECTION,
        )
        uploaded += 1

    print(f"✅ Завантажено {uploaded}/{len(chunks)} чанків з title-prefix embedding")


if __name__ == "__main__":
    for doc in DOCS_TO_REINDEX:
        reindex_doc(doc["law_id"], doc["title"])
    print("\n✅ Готово! Перезапусти backend якщо потрібно оновити текстові індекси.")
