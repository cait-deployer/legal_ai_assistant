"""
kmu_scanner.py — Скрапер НПА Кабінету Міністрів України.
Джерело: https://www.kmu.gov.ua/api/search?type=npa (JSON API)
CSRF-сесія: отримуємо cookie з головної сторінки → пагінуємо API.
Для повного тексту: zakon.rada.gov.ua (cross-ref за номером документа).
Колекція: laws_kmu
"""
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import httpx
from langchain_text_splitters import MarkdownTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

KMU_BASE        = "https://www.kmu.gov.ua"
KMU_API_SEARCH  = f"{KMU_BASE}/api/search"
RADA_BASE       = "https://zakon.rada.gov.ua"

WORKERS   = 3
PER_PAGE  = 100   # max items per API page
text_splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)
_http_sem     = threading.Semaphore(WORKERS)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "application/json, text/html,*/*",
    "Accept-Language": "uk-UA,uk;q=0.9",
    "Referer":         f"{KMU_BASE}/npas",
}


# ── CSRF-сесія ────────────────────────────────────────────────────────────────

def _make_session() -> httpx.Client:
    """Відкриває httpx-сесію з CSRF-cookie від kmu.gov.ua."""
    session = httpx.Client(
        headers=HEADERS,
        follow_redirects=True,
        verify=False,
        timeout=30,
    )
    try:
        # Отримуємо cookies (oct_session + CSRF) з будь-якої сторінки
        r = session.get(f"{KMU_BASE}/npas", timeout=20)
        # OctoberCMS: CSRF у meta-тегу або у cookie "XSRF-TOKEN"
        csrf = ""
        m = re.search(r'<meta[^>]+name=["\']csrf-token["\'][^>]+content=["\']([^"\']+)', r.text)
        if m:
            csrf = m.group(1)
        elif "XSRF-TOKEN" in session.cookies:
            csrf = session.cookies["XSRF-TOKEN"]
        if csrf:
            session.headers.update({"X-CSRF-TOKEN": csrf})
    except Exception as e:
        print(f"⚠️ KMU CSRF init: {e}")
    return session


# ── Список НПА через API ──────────────────────────────────────────────────────

def get_all_kmu_docs(log=None) -> list[dict]:
    """
    Пагінує /api/search?type=npa → збирає всі НПА КМУ.
    Повертає список dict з полями: law_id, title, url, date, doc_type.
    """
    _log = log or (lambda m, lv="info": print(m))
    session = _make_session()
    all_docs: list[dict] = []
    page = 1

    _log("🏛️  Отримуємо список НПА КМУ через API...")

    while True:
        params = {
            "type":     "npa",
            "per_page": PER_PAGE,
            "page":     page,
            "lang":     "uk",
        }
        try:
            r = session.get(KMU_API_SEARCH, params=params)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            _log(f"⚠️ API сторінка {page}: {e}", "warning")
            break

        # Визначаємо де масив документів
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = (
                data.get("items") or data.get("data") or
                data.get("results") or data.get("documents") or []
            )

        if not items:
            _log(f"📭 Сторінка {page}: порожньо — зупиняємось")
            break

        for item in items:
            if not isinstance(item, dict):
                continue
            # Нормалізуємо поля — різні версії API можуть мати різні ключі
            title   = (item.get("title") or item.get("name") or "").strip()
            url_path = item.get("url") or item.get("link") or item.get("slug") or ""
            date    = (
                item.get("created_date") or item.get("date") or
                item.get("published_at") or item.get("dateCreated") or ""
            )
            raw_id  = (
                item.get("id") or item.get("_id") or
                re.sub(r"[^\w-]", "_", url_path.rstrip("/").split("/")[-1])[:150]
            )
            doc_type = _detect_doc_type(title, url_path)

            # Зберігаємо будь-який текст/опис з API
            api_text = (
                item.get("description") or item.get("content") or
                item.get("body") or item.get("text") or item.get("annotation") or ""
            ).strip()

            full_url = (
                url_path if url_path.startswith("http")
                else f"{KMU_BASE}{url_path}" if url_path.startswith("/")
                else f"{KMU_BASE}/npas/{url_path}" if url_path
                else ""
            )

            all_docs.append({
                "law_id":   f"kmu_{str(raw_id)[:150]}",
                "title":    title or doc_type,
                "url":      full_url,
                "date":     str(date),
                "doc_type": doc_type,
                "api_text": api_text,
                # Для cross-ref на zakon.rada.gov.ua — витягуємо номер документа
                "doc_number": _extract_doc_number(title),
            })

        _log(f"  📄 Стор. {page}: +{len(items)} ({len(all_docs)} всього)")

        # Перевіряємо чи є ще сторінки
        total = None
        if isinstance(data, dict):
            total = (
                data.get("total") or data.get("count") or
                data.get("total_count") or data.get("meta", {}).get("total")
            )
        if total and len(all_docs) >= int(total):
            break
        if len(items) < PER_PAGE:
            break  # остання сторінка

        page += 1
        time.sleep(0.3)

    session.close()
    _log(f"📋 Всього НПА КМУ: {len(all_docs)}")
    return all_docs


def _detect_doc_type(title: str, url: str) -> str:
    t = f"{title} {url}".lower()
    if "розпорядж" in t: return "Розпорядження КМУ"
    if "наказ"     in t: return "Наказ КМУ"
    return "Постанова КМУ"


def _extract_doc_number(title: str) -> str:
    """Витягує '489' з 'Постанова від 10.04.2026 № 489'."""
    m = re.search(r"№\s*(\d+)", title)
    return m.group(1) if m else ""


# ── Текст документа ───────────────────────────────────────────────────────────

def _get_text_from_rada(doc_number: str, date: str, session: httpx.Client) -> str:
    """
    Шукає документ КМУ на zakon.rada.gov.ua за номером і роком.
    Повертає markdown-текст або "".
    """
    if not doc_number:
        return ""
    try:
        year = re.search(r"\b(20\d{2})\b", date)
        year_str = year.group(1) if year else ""
        # Пошук через zakon.rada.gov.ua/find
        search_url = f"{RADA_BASE}/find?type=2&search={doc_number}&org=KMU"
        if year_str:
            search_url += f"&date={year_str}"
        r = session.get(search_url, timeout=15)
        # Шукаємо перший закон в результатах
        m = re.search(r'/laws/show/([a-zA-Z0-9\-]+)', r.text)
        if not m:
            return ""
        law_id = m.group(1)
        from rada_scanner import get_law_text
        return get_law_text(law_id)
    except Exception:
        return ""


# ── Обробка одного документа ──────────────────────────────────────────────────

def process_kmu_doc(
    doc: dict,
    session: httpx.Client,
    session_id: str | None = None,
    existing_ids: set | None = None,
) -> bool | None:
    """True = успіх, None = вже є, False = помилка."""
    law_id = doc["law_id"]
    if existing_ids and law_id in existing_ids:
        return None

    # Спробуємо отримати повний текст
    text = ""

    # 1. Текст з API (якщо є)
    if doc.get("api_text") and len(doc["api_text"]) > 200:
        text = doc["api_text"]

    # 2. zakon.rada.gov.ua за номером документа
    if not text and doc.get("doc_number"):
        with _http_sem:
            text = _get_text_from_rada(doc["doc_number"], doc["date"], session)

    # 3. Fallback: назва + дата + тип як мінімальний контент
    if not text:
        text = f"{doc['doc_type']}\n\n{doc['title']}"
        if doc["date"]:
            text += f"\n\nДата: {doc['date']}"
        if doc["url"]:
            text += f"\n\nДжерело: {doc['url']}"

    if len(text) < 50:
        return False

    chunks = text_splitter.split_text(text)
    scraped_at = datetime.now(timezone.utc).isoformat()

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
                "source":        doc["title"],
                "law_id":        law_id,
                "doc_type":      doc["doc_type"],
                "category":      doc["doc_type"],
                "law_url":       doc["url"],
                "source_domain": "kmu.gov.ua",
                "status":        "чинний",
                "date":          doc["date"],
                "scraped_at":    scraped_at,
                "chunk_index":   i,
            },
            vector,
            collection_name="laws_kmu",
            session_id=session_id,
        )

    print(f"✅ KMU '{doc['title'][:60]}' → laws_kmu ({len(chunks)} ч.)")
    return True


# ── Головний цикл ─────────────────────────────────────────────────────────────

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
        log("🏛️  Синхронізація КМУ → laws_kmu (kmu.gov.ua API)...")
        docs = get_all_kmu_docs(log=log)

    total = len(docs)
    log(f"📋 Знайдено: {total} НПА КМУ")

    existing_ids = get_existing_law_ids()
    kmu_existing = {lid for lid in existing_ids if lid.startswith("kmu_")}
    log(f"📂 Вже в базі: {len(kmu_existing)}")

    # Одна сесія на весь sync — зберігаємо CSRF cookies
    http_session = _make_session()

    ok = 0
    i = start_index
    try:
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
                        process_kmu_doc, doc, http_session,
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
                            log(f"  ✅ {doc['law_id'][:70]} ({ok})", "success")
                        elif result is None:
                            log(f"  ⏭ {doc['law_id'][:70]} — вже є")
                        else:
                            log(f"  ⚠️ {doc['law_id'][:70]} — помилка", "warning")
                    except Exception as e:
                        log(f"  ❌ {doc['law_id'][:70]}: {e}", "error")

            i = batch_end
            time.sleep(0.5)
    finally:
        http_session.close()

    log(f"✅ KMU завершено. Додано: {ok}/{total}.", "success")
    return ok, total


if __name__ == "__main__":
    run_kmu_sync()
