"""
kmu_scanner.py — Скрапер НПА Кабінету Міністрів України.
Джерело: https://www.kmu.gov.ua/npas/
Стратегія: sitemap XML → HTML сторінки НПА.
Колекція: laws_kmu
"""
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

# ── Константи ──────────────────────────────────────────────────────────────────
KMU_BASE        = "https://www.kmu.gov.ua"
KMU_SITEMAP_IDX = "https://www.kmu.gov.ua/sitemap.xml"
WORKERS         = 2   # консервативно — ShieldSquare bot protection
_http_sem       = threading.Semaphore(WORKERS)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection":      "keep-alive",
    "Referer":         "https://www.kmu.gov.ua/",
}

text_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)


def _slug_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def _law_id_from_url(url: str) -> str:
    slug = _slug_from_url(url)
    clean = re.sub(r"[^\w-]", "_", slug)[:200]
    return f"kmu_{clean}"


# ── Парсинг sitemap ────────────────────────────────────────────────────────────

def _get_npa_sitemaps(log=None) -> list[str]:
    """Знаходить URL усіх NPA-sitemap через sitemap-index."""
    try:
        r = httpx.get(KMU_SITEMAP_IDX, headers=HEADERS, timeout=30, follow_redirects=True)
        r.raise_for_status()
        # Шукаємо сітемапи НПА за відомим шаблоном
        urls = re.findall(
            r'https://[^\s<>"\']+sitemap-kitsoft-npa-models-act[^\s<>"\']+\.xml',
            r.text,
        )
        if not urls:
            # Широкий fallback — будь-які <loc> що містять "npa" або "act"
            locs = re.findall(r'<loc>\s*([^<]+)\s*</loc>', r.text)
            urls = [u.strip() for u in locs if ("npa" in u.lower() or "act" in u.lower()) and u.endswith(".xml")]
        if log:
            log(f"📋 Знайдено {len(urls)} NPA sitemap файлів")
        return urls or [f"{KMU_BASE}/sitemap-kitsoft-npa-models-act-1.xml"]
    except Exception as e:
        if log:
            log(f"⚠️ Помилка читання sitemap-index: {e}", "warning")
        return [f"{KMU_BASE}/sitemap-kitsoft-npa-models-act-1.xml"]


def _parse_sitemap(sitemap_url: str, log=None) -> list[dict]:
    """Парсить один sitemap XML → [{url, lastmod, law_id}]."""
    docs = []
    try:
        r = httpx.get(sitemap_url, headers=HEADERS, timeout=60, follow_redirects=True)
        r.raise_for_status()
        locs     = re.findall(r'<loc>\s*([^<]+)\s*</loc>',         r.text)
        lastmods = re.findall(r'<lastmod>\s*([^<]+)\s*</lastmod>', r.text)
        if len(lastmods) < len(locs):
            lastmods += [""] * (len(locs) - len(lastmods))
        for loc, lastmod in zip(locs, lastmods):
            loc = loc.strip()
            if "/npas/" not in loc:
                continue
            docs.append({
                "url":     loc,
                "lastmod": lastmod.strip(),
                "law_id":  _law_id_from_url(loc),
            })
        if log:
            log(f"  {sitemap_url.split('/')[-1]}: {len(docs)} НПА")
    except Exception as e:
        if log:
            log(f"⚠️ {sitemap_url.split('/')[-1]}: {e}", "warning")
    return docs


def get_all_kmu_docs(log=None) -> list[dict]:
    """Збирає всі НПА КМУ з усіх sitemap файлів."""
    sitemap_urls = _get_npa_sitemaps(log)
    all_docs: list[dict] = []
    for url in sitemap_urls:
        docs = _parse_sitemap(url, log)
        all_docs.extend(docs)
        time.sleep(0.3)
    if log:
        log(f"📄 Всього НПА КМУ: {len(all_docs)} документів")
    return all_docs


# ── Парсинг HTML сторінки ──────────────────────────────────────────────────────

def _extract_content(html: str, url: str) -> dict:
    """Витягує заголовок, текст та тип документа з HTML сторінки НПА."""
    soup = BeautifulSoup(html, "html.parser")

    # Видаляємо шум
    for tag in soup(["nav", "header", "footer", "script", "style", "aside"]):
        tag.decompose()
    for sel in [".breadcrumb", ".share-block", ".social-share", ".sidebar", ".cookie-bar"]:
        for el in soup.select(sel):
            el.decompose()

    # Заголовок — пробуємо кілька селекторів
    title = ""
    for sel in ["h1", ".entry-title", ".news-title", "h2.news-header", "h2"]:
        el = soup.select_one(sel)
        if el:
            t = el.get_text(strip=True)
            if len(t) > 10:
                title = t
                break

    # Основний контент — пробуємо типові OctoberCMS та Bootstrap класи
    text = ""
    for sel in [
        "div.news-body", "div.entry-body", "div.post-content",
        "article.post", ".article-content", "article",
        "main .col-xs-12.col-md-9", "main .col-md-9",
        "main", "div#content", "div.content",
    ]:
        el = soup.select_one(sel)
        if el:
            t = el.get_text(separator="\n", strip=True)
            if len(t) > 200:
                text = t
                break

    # Fallback — весь body
    if len(text) < 200:
        body = soup.find("body")
        if body:
            text = body.get_text(separator="\n", strip=True)

    # Чистимо зайві пустые рядки
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    # Тип документа за заголовком/URL
    combined = f"{title} {url}".lower()
    if re.search(r"постанов", combined):
        doc_type = "Постанова КМУ"
    elif re.search(r"розпоряджен", combined):
        doc_type = "Розпорядження КМУ"
    elif re.search(r"\bнаказ", combined):
        doc_type = "Наказ"
    else:
        doc_type = "НПА КМУ"

    return {
        "title":       title or doc_type,
        "text":        text,
        "doc_type":    doc_type,
        "source_name": title if title else doc_type,
    }


# ── Обробка одного документа ──────────────────────────────────────────────────

def process_kmu_doc(
    doc: dict,
    session_id: str | None = None,
    existing_ids: set | None = None,
) -> bool | None:
    """
    Завантажує та індексує один НПА КМУ.
    True = успіх, None = вже є, False = помилка.
    """
    law_id = doc["law_id"]
    if existing_ids and law_id in existing_ids:
        return None  # вже є — пропускаємо

    try:
        with _http_sem:
            r = httpx.get(doc["url"], headers=HEADERS, timeout=30, follow_redirects=True)
        if r.status_code in (403, 429):
            print(f"⚠️ KMU {r.status_code} (bot protection): {doc['url']}")
            time.sleep(10)
            return False
        r.raise_for_status()
    except Exception as e:
        print(f"❌ KMU fetch ({doc['url']}): {e}")
        return False

    content = _extract_content(r.text, doc["url"])
    if len(content["text"]) < 100:
        print(f"⚠️ KMU порожній текст ({len(content['text'])} с): {doc['url']}")
        return False

    chunks = text_splitter.split_text(content["text"])
    scraped_at = datetime.now(timezone.utc).isoformat()

    # Batch embed
    vectors: list = []
    try:
        for b in range(0, len(chunks), 5):
            vectors.extend(embeddings.embed_documents(chunks[b:b + 5]))
    except Exception as e:
        print(f"⚠️ KMU batch embed → поштучно: {e}")
        vectors = []
        for chunk in chunks:
            try:
                vectors.append(embeddings.embed_query(chunk))
            except Exception:
                vectors.append(None)

    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        if vector is None:
            continue
        upload_to_qdrant(
            chunk_text,
            {
                "source":        content["source_name"],
                "law_id":        law_id,
                "doc_type":      content["doc_type"],
                "category":      content["doc_type"],
                "law_url":       doc["url"],
                "source_domain": "kmu.gov.ua",
                "lastmod":       doc.get("lastmod", ""),
                "scraped_at":    scraped_at,
                "chunk_index":   i,
                "status":        "чинний",
            },
            vector,
            collection_name="laws_kmu",
            session_id=session_id,
        )

    print(f"✅ KMU '{content['source_name'][:60]}' → laws_kmu ({len(chunks)} ч.)")
    return True


# ── Головний цикл синхронізації ───────────────────────────────────────────────

def run_kmu_sync(
    session_id: str | None = None,
    log_callback=None,
    pause_check=None,
    on_pause=None,
    start_index: int = 0,
    docs_cached: list | None = None,
) -> tuple[int, int]:
    """
    Синхронізує kmu.gov.ua → laws_kmu.
    Повертає (ok_count, total_count).
    """
    def log(msg: str, level: str = "info") -> None:
        print(msg)
        if log_callback:
            log_callback(msg, level)

    if docs_cached and start_index > 0:
        docs = docs_cached
        log(f"▶️  Відновлення KMU з індексу {start_index}")
    else:
        log("🏛️  Починаємо синхронізацію КМУ → laws_kmu...")
        log("🔍 Читаємо sitemap kmu.gov.ua...")
        docs = get_all_kmu_docs(log=log)

    total = len(docs)
    log(f"📋 Знайдено: {total} НПА документів")

    existing_ids = get_existing_law_ids()
    log(f"📂 Вже в базі: {len(existing_ids)} документів")

    skipped = sum(1 for d in docs[start_index:] if d["law_id"] in existing_ids)
    log(f"🔄 Нових для обробки: ~{total - start_index - skipped}")

    ok = 0
    i = start_index
    while i < total:
        if pause_check and pause_check():
            if on_pause:
                on_pause(docs, i, ok)
            log(f"⏸️  Призупинено на {i}/{total}. Додано: {ok}", "warning")
            return ok, total

        batch_end = min(i + WORKERS, total)
        batch = docs[i:batch_end]
        log(f"📥 [{i + 1}–{batch_end}/{total}]")

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {
                pool.submit(
                    process_kmu_doc, doc,
                    session_id=session_id,
                    existing_ids=existing_ids,
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
        time.sleep(2.0)  # пауза між батчами — bot protection

    log(f"✅ KMU синхронізацію завершено. Додано: {ok}/{total}.", "success")
    return ok, total


if __name__ == "__main__":
    run_kmu_sync()
