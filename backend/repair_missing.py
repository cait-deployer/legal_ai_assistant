"""
repair_missing.py — Переіндексує тільки ті закони, яких немає в Qdrant.

Використовуй після збоїв (Qdrant timeout), коли частина законів не записалась.
Набагато швидше за повний переіндекс — обробляє тільки відсутні.

Запуск:
  python repair_missing.py --kmu     # тільки КМУ
  python repair_missing.py --rada    # тільки Рада
  python repair_missing.py --both    # обидва (послідовно)
"""
import argparse
import json
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import (
    upload_to_qdrant, delete_law_chunks,
    get_existing_laws_meta, RADA_COLLECTIONS,
    get_collection_for_category,
)

WORKERS    = 4
EMBED_BATCH = 10

_http_sem   = threading.Semaphore(WORKERS)
_print_lock = threading.Lock()


def _log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


def _get_existing_ids(collection_name: str) -> set[str]:
    """Повертає set law_id що мають хоча б chunk_index=0 в колекції."""
    meta = get_existing_laws_meta(collection_name)
    return set(meta.keys())


# ── КМУ ───────────────────────────────────────────────────────────────────────

def repair_kmu() -> None:
    from rada_scanner import get_law_text, get_law_metadata, BASE
    from kmu_scanner import get_all_kmu_docs, _kmu_doc_type

    COLLECTION = "laws_kmu"
    IDS_CACHE  = "reindex_kmu_ids_cache.json"
    splitter   = MarkdownTextSplitter(chunk_size=4000, chunk_overlap=400)

    # 1. Завантажуємо список документів
    if os.path.exists(IDS_CACHE):
        with open(IDS_CACHE) as f:
            docs = json.load(f)
        _log(f"📦 Кеш KMU: {len(docs)} документів")
    else:
        _log("📡 Завантаження списку КМУ (5–15 хв)...")
        docs = get_all_kmu_docs()

    # 2. Перевіряємо що є в Qdrant
    _log(f"🔍 Перевіряю {COLLECTION} в Qdrant...")
    existing = _get_existing_ids(COLLECTION)
    _log(f"   В Qdrant: {len(existing)} законів")

    # 3. Знаходимо відсутні
    missing = [d for d in docs if f"kmu_{d['id']}" not in existing]
    _log(f"⚠️  Відсутніх: {len(missing)} з {len(docs)}")

    if not missing:
        _log("✅ KMU — всі закони присутні, нічого відновлювати.")
        return

    # 4. Переіндексуємо відсутні
    _log(f"🔄 Відновлення {len(missing)} КМУ документів (WORKERS={WORKERS})...")

    def _process(doc: dict) -> tuple[str, bool]:
        law_id    = doc["id"]
        stored_id = f"kmu_{law_id}"
        title     = doc.get("title", "")
        doc_type  = _kmu_doc_type(title, law_id)
        law_url   = f"{BASE}/laws/show/{law_id}"

        text = None
        for attempt in range(3):
            with _http_sem:
                text = get_law_text(law_id)
            if text and len(text) >= 100:
                break
            if attempt < 2:
                time.sleep(1.5)

        if not text or len(text) < 100:
            return stored_id, False

        meta       = get_law_metadata(law_id)
        scraped_at = datetime.now(timezone.utc).isoformat()
        chunks     = splitter.split_text(text)
        if not chunks:
            return stored_id, False

        prefixed = [f"{title}\n\n{chunk}" for chunk in chunks]
        vectors: list = []
        try:
            for b in range(0, len(prefixed), EMBED_BATCH):
                vectors.extend(embeddings.embed_documents(prefixed[b:b + EMBED_BATCH]))
        except Exception as e:
            _log(f"  ⚠️ embed fallback {stored_id}: {e}")
            for pc in prefixed:
                try:    vectors.append(embeddings.embed_query(pc))
                except: vectors.append(None)

        delete_law_chunks(stored_id, COLLECTION)
        uploaded = 0
        for i, (chunk_text, vector) in enumerate(zip(prefixed, vectors)):
            if vector is None:
                continue
            if upload_to_qdrant(chunk_text, {
                "source":        title or doc_type,
                "law_id":        stored_id,
                "doc_type":      doc_type,
                "category":      doc_type,
                "law_url":       law_url,
                "source_domain": "zakon.rada.gov.ua",
                "status":        meta.get("status", "Чинний"),
                "doc_number":    meta.get("doc_number", ""),
                "date_adopted":  meta.get("date_adopted", ""),
                "scraped_at":    scraped_at,
                "chunk_index":   i,
                "reindexed":     True,
            }, vector, collection_name=COLLECTION):
                uploaded += 1

        return stored_id, uploaded > 0

    ok = errors = 0
    total = len(missing)
    i = 0
    while i < total:
        batch = missing[i:i + WORKERS]
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {pool.submit(_process, doc): doc for doc in batch}
            for fut in as_completed(futs):
                doc = futs[fut]
                try:
                    stored_id, success = fut.result()
                    if success:
                        ok += 1
                        _log(f"  ✅ [{ok}/{total}] {stored_id[:70]}")
                    else:
                        errors += 1
                        _log(f"  ⚠️ [{i}/{total}] {doc['id'][:70]} — порожній")
                except Exception as e:
                    errors += 1
                    _log(f"  ❌ {doc['id'][:70]}: {e}")
        i += WORKERS
        time.sleep(0.5)

    _log(f"{'='*60}")
    _log(f"✅ KMU repair: відновлено {ok}/{total}, помилки: {errors}")


# ── РАДА ──────────────────────────────────────────────────────────────────────

def repair_rada() -> None:
    from rada_scanner import get_all_legal_ids, get_law_text, get_law_metadata, detect_text_flags, BASE

    IDS_CACHE = "reindex_rada_ids_cache.json"
    splitter  = MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300)

    # 1. Список законів
    if os.path.exists(IDS_CACHE):
        with open(IDS_CACHE) as f:
            all_laws = json.load(f)
        _log(f"📦 Кеш Ради: {len(all_laws)} законів")
    else:
        _log("📡 Завантаження списку Ради (15–30 хв)...")
        all_laws = get_all_legal_ids()

    # 2. Перевіряємо всі rada_* колекції
    _log("🔍 Перевіряю всі Рада-колекції в Qdrant...")
    existing: set[str] = set()
    for coll in RADA_COLLECTIONS:
        ids = _get_existing_ids(coll)
        existing.update(ids)
        _log(f"   {coll}: {len(ids)}")
    _log(f"   Всього в Qdrant: {len(existing)}")

    # 3. Відсутні
    missing = [law for law in all_laws if law["id"] not in existing]
    _log(f"⚠️  Відсутніх: {len(missing)} з {len(all_laws)}")

    if not missing:
        _log("✅ Рада — всі закони присутні, нічого відновлювати.")
        return

    _log(f"🔄 Відновлення {len(missing)} законів Ради (WORKERS={WORKERS})...")

    def _process(law: dict) -> tuple[str, str, bool]:
        law_id    = law["id"]
        law_title = law.get("title", "")
        category  = law.get("category", "")
        law_url   = f"{BASE}/laws/show/{law_id}"
        coll      = get_collection_for_category(category)

        text = None
        for attempt in range(3):
            with _http_sem:
                text = get_law_text(law_id)
            if text and len(text) >= 50:
                break
            if text == "__RESTRICTED__":
                break
            if attempt < 2:
                time.sleep(1.5)

        if not text or len(text) < 50 or text == "__RESTRICTED__":
            return law_id, coll, False

        law_meta   = get_law_metadata(law_id)
        text_flags = detect_text_flags(text)
        scraped_at = datetime.now(timezone.utc).isoformat()
        chunks     = splitter.split_text(text)
        if not chunks:
            return law_id, coll, False

        prefixed = [f"{law_title}\n\n{chunk}" for chunk in chunks]
        vectors: list = []
        try:
            for b in range(0, len(prefixed), EMBED_BATCH):
                vectors.extend(embeddings.embed_documents(prefixed[b:b + EMBED_BATCH]))
        except Exception as e:
            _log(f"  ⚠️ embed fallback {law_id}: {e}")
            for pc in prefixed:
                try:    vectors.append(embeddings.embed_query(pc))
                except: vectors.append(None)

        delete_law_chunks(law_id, coll)
        uploaded = 0
        for i, (chunk_text, vector) in enumerate(zip(prefixed, vectors)):
            if vector is None:
                continue
            if upload_to_qdrant(chunk_text, {
                "source":          law_title,
                "law_id":          law_id,
                "category":        category,
                "law_url":         law_url,
                "source_domain":   "zakon.rada.gov.ua",
                "status":          law_meta.get("status", "Чинний"),
                "doc_number":      law_meta.get("doc_number", ""),
                "date_adopted":    law_meta.get("date_adopted", ""),
                "effective_date":  law.get("list_date", ""),
                "scraped_at":      scraped_at,
                "chunk_index":     i,
                "reindexed":       True,
                **text_flags,
            }, vector, collection_name=coll):
                uploaded += 1

        return law_id, coll, uploaded > 0

    ok = errors = 0
    total = len(missing)
    i = 0
    while i < total:
        batch = missing[i:i + WORKERS]
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {pool.submit(_process, law): law for law in batch}
            for fut in as_completed(futs):
                law = futs[fut]
                try:
                    law_id, coll, success = fut.result()
                    if success:
                        ok += 1
                        _log(f"  ✅ [{ok}/{total}] {law_id[:60]} → {coll}")
                    else:
                        errors += 1
                        _log(f"  ⚠️ [{i}/{total}] {law['id'][:60]} — порожній")
                except Exception as e:
                    errors += 1
                    _log(f"  ❌ {law['id'][:60]}: {e}")
        i += WORKERS
        time.sleep(0.5)

    _log(f"{'='*60}")
    _log(f"✅ Рада repair: відновлено {ok}/{total}, помилки: {errors}")


# ── MAIN ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Repair missing Qdrant documents")
    parser.add_argument("--kmu",  action="store_true", help="Repair laws_kmu")
    parser.add_argument("--rada", action="store_true", help="Repair rada_* collections")
    parser.add_argument("--both", action="store_true", help="Repair both")
    args = parser.parse_args()

    if not any([args.kmu, args.rada, args.both]):
        parser.print_help()
        sys.exit(1)

    if args.both or args.kmu:
        _log("\n🔧 === REPAIR KMU ===")
        repair_kmu()

    if args.both or args.rada:
        _log("\n🔧 === REPAIR РАДА ===")
        repair_rada()
