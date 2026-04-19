"""
reindex_kmu_full.py — Повний переіндекс laws_kmu з title-prefix та chunk_size=4000.

Покращення vs старого сканера:
  - chunk_size 1500 → 4000 (таблиці з сумами не розбиваються)
  - title-prefix у кожному чанку (embedding знає назву закону)
  - 8 воркерів замість 4 (удвічі швидше)
  - embed batch 10 замість 5
  - sleep 0.2s замість 0.5s

Запуск:   python reindex_kmu_full.py
Зупинка:  Ctrl+C — прогрес збережено у reindex_kmu_full_state.json
Продовження: python reindex_kmu_full.py  (автоматично з того місця)
"""
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, delete_law_chunks

COLLECTION   = "laws_kmu"
WORKERS      = 8
EMBED_BATCH  = 10
SLEEP_SEC    = 0.2
STATE_FILE   = "reindex_kmu_full_state.json"

text_splitter = MarkdownTextSplitter(chunk_size=4000, chunk_overlap=400)
_http_sem = threading.Semaphore(WORKERS)
_print_lock = threading.Lock()


def _log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"start_index": 0, "ok": 0, "errors": 0}


def _save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def _process_one(doc: dict) -> tuple[str, bool]:
    """Переіндексує один КМУ документ. Повертає (law_id, успіх)."""
    from rada_scanner import get_law_text, get_law_metadata, BASE
    from kmu_scanner import _kmu_doc_type

    law_id    = doc["id"]
    stored_id = f"kmu_{law_id}"
    title     = doc.get("title", "")
    doc_type  = _kmu_doc_type(title, law_id)
    law_url   = f"{BASE}/laws/show/{law_id}"

    with _http_sem:
        text = get_law_text(law_id)

    if not text or len(text) < 100:
        return stored_id, False

    meta       = get_law_metadata(law_id)
    scraped_at = datetime.now(timezone.utc).isoformat()

    chunks = text_splitter.split_text(text)
    if not chunks:
        return stored_id, False

    # Title-prefix: embedding бачить назву документу в кожному чанку
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

    # Видаляємо старі чанки ПЕРЕД завантаженням нових
    delete_law_chunks(stored_id, COLLECTION)

    uploaded = 0
    for i, (chunk_text, vector) in enumerate(zip(prefixed, vectors)):
        if vector is None:
            continue
        upload_to_qdrant(
            chunk_text,
            {
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
                "reindexed":     True,  # маркер нового індексу
            },
            vector,
            collection_name=COLLECTION,
        )
        uploaded += 1

    return stored_id, uploaded > 0


def run_full_reindex(log_callback=None, stop_event=None) -> None:
    from kmu_scanner import get_all_kmu_docs

    def log(msg: str, level: str = "info") -> None:
        _log(msg)
        if log_callback:
            try:
                log_callback(msg, level)
            except Exception:
                pass

    state = _load_state()
    start_index = state.get("start_index", 0)
    ok    = state.get("ok", 0)
    errors = state.get("errors", 0)

    if start_index > 0:
        log(f"▶️  Відновлення з індексу {start_index} (вже оброблено: {ok} ✅  {errors} ❌)")

    log("📡 Завантаження списку КМУ документів (може зайняти 5–15 хв)...")
    docs = get_all_kmu_docs(log=log)
    total = len(docs)
    log(f"📋 Всього: {total} НПА КМУ | Воркерів: {WORKERS} | Chunk: 4000 | Batch: {EMBED_BATCH}")
    log(f"⏱️  Орієнтовний час: ~{total // WORKERS * 3 // 3600 + 1} год")

    i = start_index
    try:
        while i < total:
            if stop_event and stop_event.is_set():
                log(f"⏸️  Зупинено. Збережено прогрес: {i}/{total}", "warning")
                _save_state({"start_index": i, "ok": ok, "errors": errors})
                return

            batch_end = min(i + WORKERS, total)
            batch     = docs[i:batch_end]

            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futs = {pool.submit(_process_one, doc): doc for doc in batch}
                for fut in as_completed(futs):
                    doc = futs[fut]
                    try:
                        stored_id, success = fut.result()
                        if success:
                            ok += 1
                            log(f"  ✅ [{ok}/{total}] {stored_id[:70]}", "success")
                        else:
                            errors += 1
                            log(f"  ⚠️ [{i}/{total}] {doc['id'][:70]} — порожній або помилка", "warning")
                    except Exception as e:
                        errors += 1
                        log(f"  ❌ {doc['id'][:70]}: {e}", "error")

            i = batch_end

            # Зберігаємо прогрес кожні 50 батчів (~400 документів)
            if (i // WORKERS) % 50 == 0:
                _save_state({"start_index": i, "ok": ok, "errors": errors})
                log(f"💾 Прогрес збережено: {i}/{total} ({ok} ✅ {errors} ❌)")

            time.sleep(SLEEP_SEC)

    except KeyboardInterrupt:
        log(f"\n⏸️  Зупинено користувачем. Збережено прогрес: {i}/{total}", "warning")
        _save_state({"start_index": i, "ok": ok, "errors": errors})
        return

    # Очищаємо state після успішного завершення
    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)

    log(f"{'='*60}")
    log(f"✅ Переіндекс КМУ завершено! Оброблено: {ok}/{total}. Помилки: {errors}", "success")
    log("   Перезапусти backend: systemctl restart backend.service")


if __name__ == "__main__":
    run_full_reindex()
