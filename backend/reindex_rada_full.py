"""
reindex_rada_full.py — Повний переіндекс rada_* колекцій з title-prefix та chunk_size=3000.

Покращення vs старого сканера:
  - chunk_size 1500 → 3000 (більше контексту в кожному чанку)
  - title-prefix у кожному чанку (embedding знає назву закону)
  - 8 воркерів замість 3
  - embed batch 10 замість 5
  - sleep 0.2s замість 0.5s

Запуск:       python reindex_rada_full.py
Зупинка:      Ctrl+C — прогрес збережено у reindex_rada_full_state.json
Продовження:  python reindex_rada_full.py  (автоматично з того місця)
"""
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, delete_law_chunks, get_collection_for_category

WORKERS        = 4
EMBED_BATCH    = 5
SLEEP_SEC      = 0.5
STATE_FILE     = "reindex_rada_full_state.json"
IDS_CACHE_FILE = "reindex_rada_ids_cache.json"
IDS_CACHE_TTL  = 48 * 3600  # секунд: 48 год

text_splitter = MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300)
_http_sem   = threading.Semaphore(WORKERS)
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


def _load_ids_cache() -> list[dict] | None:
    if not os.path.exists(IDS_CACHE_FILE):
        return None
    try:
        age = time.time() - os.path.getmtime(IDS_CACHE_FILE)
        if age > IDS_CACHE_TTL:
            return None
        with open(IDS_CACHE_FILE) as f:
            return json.load(f)
    except Exception:
        return None


def _save_ids_cache(laws: list[dict]) -> None:
    with open(IDS_CACHE_FILE, "w") as f:
        json.dump(laws, f)


def _process_one(law: dict) -> tuple[str, str, bool]:
    """Переіндексує один закон Ради. Повертає (law_id, collection, успіх)."""
    from rada_scanner import get_law_text, get_law_metadata, detect_text_flags, BASE

    law_id    = law["id"]
    law_title = law.get("title", "")
    category  = law.get("category", "")
    law_url   = f"{BASE}/laws/show/{law_id}"
    coll      = get_collection_for_category(category)

    text = None
    for _attempt in range(3):
        with _http_sem:
            text = get_law_text(law_id)
        if text and len(text) >= 50:
            break
        if text == "__RESTRICTED__":
            break
        if _attempt < 2:
            time.sleep(1.5)

    if not text or len(text) < 50:
        return law_id, coll, False

    if text == "__RESTRICTED__":
        return law_id, coll, False

    law_meta   = get_law_metadata(law_id)
    text_flags = detect_text_flags(text)
    scraped_at = datetime.now(timezone.utc).isoformat()

    chunks = text_splitter.split_text(text)
    if not chunks:
        return law_id, coll, False

    # Title-prefix: embedding знає назву закону в кожному чанку
    prefixed = [f"{law_title}\n\n{chunk}"[:8000] for chunk in chunks]

    vectors: list = []
    try:
        for b in range(0, len(prefixed), EMBED_BATCH):
            vectors.extend(embeddings.embed_documents(prefixed[b:b + EMBED_BATCH]))
    except Exception as e:
        _log(f"  ⚠️ embed fallback {law_id}: {e}")
        for pc in prefixed:
            try:    vectors.append(embeddings.embed_query(pc))
            except: vectors.append(None)

    # Видаляємо старі чанки ПЕРЕД завантаженням нових
    delete_law_chunks(law_id, coll)

    uploaded = 0
    for i, (chunk_text, vector) in enumerate(zip(prefixed, vectors)):
        if vector is None:
            continue
        ok = upload_to_qdrant(
            chunk_text,
            {
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
            },
            vector,
            collection_name=coll,
        )
        if ok:
            uploaded += 1

    return law_id, coll, uploaded > 0


def run_full_reindex(log_callback=None, stop_event=None) -> None:
    from rada_scanner import get_all_legal_ids

    def log(msg: str, level: str = "info") -> None:
        _log(msg)
        if log_callback:
            try:
                log_callback(msg, level)
            except Exception:
                pass

    state       = _load_state()
    start_index = state.get("start_index", 0)
    ok          = state.get("ok", 0)
    errors      = state.get("errors", 0)

    if start_index > 0:
        log(f"▶️  Відновлення з індексу {start_index} (вже: {ok} ✅  {errors} ❌)")

    all_laws = _load_ids_cache()
    if all_laws:
        log(f"📦 Використовую кеш ID: {len(all_laws)} законів Ради (збірка пропущена)")
    else:
        log("📡 Завантаження списку законів Ради (може зайняти 15–30 хв)...")
        all_laws = get_all_legal_ids(log=log)
        _save_ids_cache(all_laws)
        log(f"💾 ID кеш збережено: {len(all_laws)} законів")
    total    = len(all_laws)

    log(f"📋 Всього: {total} законів | Воркерів: {WORKERS} | Chunk: 3000 | Batch: {EMBED_BATCH}")
    hrs = max(1, total // WORKERS * 4 // 3600)
    log(f"⏱️  Орієнтовний час: ~{hrs} год")

    i = start_index
    try:
        while i < total:
            if stop_event and stop_event.is_set():
                log(f"⏸️  Зупинено. Збережено прогрес: {i}/{total}", "warning")
                _save_state({"start_index": i, "ok": ok, "errors": errors})
                return

            batch_end = min(i + WORKERS, total)
            batch     = all_laws[i:batch_end]

            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futs = {pool.submit(_process_one, law): law for law in batch}
                for fut in as_completed(futs):
                    law = futs[fut]
                    try:
                        law_id, coll, success = fut.result()
                        if success:
                            ok += 1
                            log(f"  ✅ [{ok}/{total}] {law_id} → {coll}", "success")
                        else:
                            errors += 1
                            log(f"  ⚠️ [{i}/{total}] {law['id'][:60]} — порожній", "warning")
                    except Exception as e:
                        errors += 1
                        log(f"  ❌ {law['id'][:60]}: {e}", "error")

            i = batch_end

            # Зберігаємо прогрес кожні 50 батчів (~400 законів)
            if (i // WORKERS) % 50 == 0:
                _save_state({"start_index": i, "ok": ok, "errors": errors})
                log(f"💾 Прогрес: {i}/{total} ({ok} ✅ {errors} ❌)")

            time.sleep(SLEEP_SEC)

    except KeyboardInterrupt:
        log(f"\n⏸️  Зупинено. Збережено прогрес: {i}/{total}", "warning")
        _save_state({"start_index": i, "ok": ok, "errors": errors})
        return

    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)
    if os.path.exists(IDS_CACHE_FILE):
        os.remove(IDS_CACHE_FILE)

    log(f"{'='*60}")
    log(f"✅ Переіндекс Ради завершено! Оброблено: {ok}/{total}. Помилки: {errors}", "success")
    log("   Перезапусти backend: systemctl restart backend.service")


if __name__ == "__main__":
    run_full_reindex()
