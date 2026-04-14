"""
kmu_scanner.py — Скрапер НПА Кабінету Міністрів України.
Джерело: https://zakon.rada.gov.ua/laws/main/o2
(Документи видавника "Кабінет Міністрів України" — 88 000+ НПА)
Колекція: laws_kmu
"""
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

# Секція КМУ на zakon.rada.gov.ua: /laws/main/o2 = Документи видавника КМУ
KMU_SECTION_CODE  = "o2"
KMU_SECTION_LABEL = "Кабінет Міністрів України"

WORKERS = 4
text_splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)
_http_sem = threading.Semaphore(WORKERS)


def _kmu_doc_type(title: str, law_id: str) -> str:
    t = f"{title} {law_id}".lower()
    if "розпорядж" in t: return "Розпорядження КМУ"
    if "наказ"     in t: return "Наказ КМУ"
    if "постанов"  in t: return "Постанова КМУ"
    return "НПА КМУ"


def get_all_kmu_docs(log=None) -> list[dict]:
    """Збирає всі НПА КМУ з zakon.rada.gov.ua/laws/main/o2."""
    from rada_scanner import get_laws_from_section

    _log = log or (lambda m, lv="info": print(m))
    _log(f"📡 Сканування КМУ: zakon.rada.gov.ua/laws/main/{KMU_SECTION_CODE}")
    docs = get_laws_from_section(KMU_SECTION_CODE, KMU_SECTION_LABEL, log=_log)
    _log(f"📄 Всього НПА КМУ: {len(docs)} документів")
    return docs


def process_kmu_doc(
    doc: dict,
    session_id: str | None = None,
    existing_ids: set | None = None,
) -> bool | None:
    """True = успіх, None = вже є, False = помилка."""
    from rada_scanner import get_law_text, get_law_metadata, BASE

    law_id = doc["id"]
    stored_id = f"kmu_{law_id}"

    if existing_ids and stored_id in existing_ids:
        return None

    law_url = f"{BASE}/laws/show/{law_id}"

    with _http_sem:
        text = get_law_text(law_id)

    if not text or len(text) < 100:
        return False

    meta     = get_law_metadata(law_id)
    title    = doc.get("title", "")
    doc_type = _kmu_doc_type(title, law_id)
    scraped_at = datetime.now(timezone.utc).isoformat()

    chunks = text_splitter.split_text(text)

    vectors: list = []
    try:
        for b in range(0, len(chunks), 5):
            vectors.extend(embeddings.embed_documents(chunks[b:b + 5]))
    except Exception as e:
        print(f"⚠️ KMU embed fallback: {e}")
        vectors = []
        for chunk in chunks:
            try:    vectors.append(embeddings.embed_query(chunk))
            except: vectors.append(None)

    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
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
            },
            vector,
            collection_name="laws_kmu",
            session_id=session_id,
        )

    print(f"✅ KMU '{title[:60]}' → laws_kmu ({len(chunks)} ч.)")
    return True


def run_kmu_sync(
    session_id: str | None = None,
    log_callback=None,
    pause_check=None,
    on_pause=None,
    start_index: int = 0,
    docs_cached: list | None = None,
) -> tuple[int, int]:
    def log(msg: str, level: str = "info") -> None:
        print(msg)
        if log_callback:
            log_callback(msg, level)

    if docs_cached and start_index > 0:
        docs = docs_cached
        log(f"▶️  Відновлення KMU з індексу {start_index}")
    else:
        log("🏛️  Синхронізація КМУ → laws_kmu (zakon.rada.gov.ua/laws/main/o2)...")
        docs = get_all_kmu_docs(log=log)

    total = len(docs)
    log(f"📋 Знайдено: {total} НПА КМУ")

    if total == 0:
        log("⚠️ Список порожній — перевір доступність zakon.rada.gov.ua", "warning")
        return 0, 0

    existing_ids = get_existing_law_ids()
    kmu_existing = {lid for lid in existing_ids if lid.startswith("kmu_")}
    log(f"📂 Вже в базі: {len(kmu_existing)}")

    ok = 0
    i = start_index
    while i < total:
        if pause_check and pause_check():
            if on_pause:
                on_pause(docs, i, ok)
            log(f"⏸️  Призупинено {i}/{total}. Додано: {ok}", "warning")
            return ok, total

        batch_end = min(i + WORKERS, total)
        batch = docs[i:batch_end]
        log(f"📥 [{i + 1}–{batch_end}/{total}]")

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {
                pool.submit(
                    process_kmu_doc, doc,
                    session_id=session_id,
                    existing_ids=kmu_existing,
                ): doc
                for doc in batch
            }
            for fut in as_completed(futs):
                doc = futs[fut]
                try:
                    result = fut.result()
                    if result is True:
                        ok += 1
                        log(f"  ✅ {doc['id'][:70]} ({ok})", "success")
                    elif result is None:
                        log(f"  ⏭ {doc['id'][:70]} — вже є")
                    else:
                        log(f"  ⚠️ {doc['id'][:70]} — помилка", "warning")
                except Exception as e:
                    log(f"  ❌ {doc['id'][:70]}: {e}", "error")

        i = batch_end
        time.sleep(0.5)

    log(f"✅ KMU завершено. Додано: {ok}/{total}.", "success")
    return ok, total


if __name__ == "__main__":
    run_kmu_sync()
