"""
ccu_scanner.py — Скрапер рішень Конституційного суду України.
Джерело: https://ccu.gov.ua/docs-search

Скрапимо тільки:
  - Рішення КСУ  (номер містить «-р»)
  - Висновки КСУ (номер містить «-в»)
Пропускаємо Ухвали («-у», «-уп») та процесуальні акти.
"""

import io
import re
import time
import tempfile
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
import embed_v2
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

# Семафор обмежує одночасні HTTP-запити до ccu.gov.ua (не більше 2 за раз)
_ccu_http_sem = threading.Semaphore(2)
CCU_WORKERS = 3

CCU_SEARCH_URL = "https://ccu.gov.ua/docs-search"
CCU_BASE_URL   = "https://ccu.gov.ua"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8",
    "Referer": "https://ccu.gov.ua/",
}

text_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)

# ── Яки типи залишати ─────────────────────────────────────────────────────────


# Типи що зберігаємо:
#   -р/  → Рішення КСУ (конституційне провадження, обов'язкові)
#   -в/  → Висновок КСУ (офіційне тлумачення, рідко але важливо)
KEEP_PATTERN = re.compile(r"-р[/(\s]|-р$|-в[/(\s]|-в$", re.IGNORECASE)

# Типи що пропускаємо за номером (навіть без перевірки тексту):
#   -у   → Ухвала (процесуальна, відмова тощо)
#   -уп  → Ухвала процесуальна
#   -п   → Постанова (адміністративні акти КСУ — склад комісій, відрядження тощо)
SKIP_PATTERN = re.compile(r"-у[/(\s]|-у$|-уп[/(\s]|-уп$|-п[/(\s]|-п$", re.IGNORECASE)


def _should_keep(doc_num: str, title: str) -> bool:
    """True = зберегти (рішення або висновок)."""
    if SKIP_PATTERN.search(doc_num):
        return False
    if KEEP_PATTERN.search(doc_num):
        return True
    # Нечіткий номер (напр. 2-3(ІІ)/2026) — пропускаємо
    return False


# ── Парсинг списку сторінок ───────────────────────────────────────────────────

def get_ccu_docs_on_page(page: int) -> list[dict]:
    """
    Повертає список документів з однієї сторінки.
    Кожен елемент: {doc_num, date, title, author, pdf_url}
    """
    params = {
        "tid": "All",
        "date_filter[value][date]": "",
        "body_value": "",
        "field_textindex_value": "",
        "field_speaker_value": "",
        "page": str(page),
    }
    try:
        r = httpx.get(CCU_SEARCH_URL, params=params, headers=HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"❌ CCU page {page}: {e}")
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table", class_=re.compile(r"views-table"))
    if not table:
        return []

    docs = []
    for row in table.find("tbody").find_all("tr"):  # type: ignore[union-attr]
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        doc_num = cells[0].get_text(separator=" ", strip=True)
        # дата може бути у клітинці 0 (після номера) або у клітинці 1
        raw_date = cells[1].get_text(strip=True) if len(cells) > 1 else ""
        title    = cells[2].get_text(strip=True) if len(cells) > 2 else ""
        author   = cells[3].get_text(strip=True) if len(cells) > 3 else ""

        # Шукаємо PDF-посилання або посилання на сторінку документа
        pdf_url = None
        doc_url = None
        for cell in cells:
            for a in cell.find_all("a", href=True):
                href = a["href"]
                if re.search(r"\.(pdf|docx?)", href, re.IGNORECASE):
                    pdf_url = href if href.startswith("http") else CCU_BASE_URL + href
                    break
                elif re.search(r"/docs/\d+", href) and not doc_url:
                    doc_url = href if href.startswith("http") else CCU_BASE_URL + href
            if pdf_url:
                break

        if not pdf_url and not doc_url:
            continue  # ні PDF, ні сторінки документа — пропускаємо

        docs.append({
            "doc_num":  doc_num,
            "date":     raw_date,
            "title":    title,
            "author":   author,
            "pdf_url":  pdf_url,
            "doc_url":  doc_url,  # fallback: сторінка документа
        })

    return docs


def get_total_pages() -> int:
    """Визначає кількість сторінок через пагінацію."""
    try:
        r = httpx.get(CCU_SEARCH_URL, params={"tid": "All", "page": "0"},
                      headers=HEADERS, timeout=30)
        soup = BeautifulSoup(r.text, "html.parser")

        # Шукаємо будь-які посилання з page=N і беремо максимум.
        # Не залежить від конкретного класу пагінатора (Drupal 7/9/10 мають різні).
        max_page = 0
        for a in soup.find_all("a", href=True):
            m = re.search(r"[?&]page=(\d+)", a["href"])
            if m:
                max_page = max(max_page, int(m.group(1)))

        if max_page > 0:
            print(f"📄 CCU: знайдено {max_page + 1} сторінок (page 0..{max_page})")
            return max_page + 1  # page=N → індексація з 0, значить N+1 сторінок

        # Якщо пагінації немає — одна сторінка
        print("📄 CCU: пагінація не знайдена — одна сторінка")
        return 1
    except Exception as e:
        print(f"⚠️ get_total_pages: {e}")
        return 350  # безпечний fallback


def get_all_ccu_docs(log=None) -> list[dict]:
    """
    Проходить усі сторінки та повертає список документів,
    що пройшли фільтр (лише рішення та висновки).
    """
    total_pages = get_total_pages()
    if log:
        log(f"📄 CCU: всього сторінок — {total_pages}")

    result = []
    for page in range(total_pages):
        docs = get_ccu_docs_on_page(page)
        kept = [d for d in docs if _should_keep(d["doc_num"], d["title"])]
        result.extend(kept)
        if log and (page % 20 == 0 or page == total_pages - 1):
            log(f"  Сторінка {page + 1}/{total_pages}: знайдено {len(kept)}/{len(docs)} (всього {len(result)})")
        time.sleep(0.5)

    return result


# ── Обробка PDF ───────────────────────────────────────────────────────────────

def _get_pdf_url_from_doc_page(doc_url: str) -> str | None:
    """Заходить на сторінку документа КСУ і знаходить пряме посилання на PDF."""
    try:
        with _ccu_http_sem:
            r = httpx.get(doc_url, headers=HEADERS, timeout=30, follow_redirects=True)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if re.search(r"\.(pdf|docx?)", href, re.IGNORECASE):
                return href if href.startswith("http") else CCU_BASE_URL + href
        return None
    except Exception as e:
        print(f"⚠️ _get_pdf_url_from_doc_page ({doc_url}): {e}")
        return None


def _extract_pdf_text(file_url: str) -> str:
    """Завантажує PDF або DOC/DOCX і повертає чистий текст."""
    is_doc = re.search(r"\.docx?$", file_url, re.IGNORECASE)
    suffix = ".docx" if (is_doc and "docx" in file_url.lower()) else (".doc" if is_doc else ".pdf")

    try:
        with _ccu_http_sem:
            r = httpx.get(file_url, headers=HEADERS, timeout=60, follow_redirects=True)
        r.raise_for_status()
    except Exception as e:
        print(f"❌ File download ({file_url}): {e}")
        return ""

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(r.content)
        tmp_path = tmp.name

    text = ""
    try:
        if suffix == ".pdf":
            try:
                from langchain_community.document_loaders import PyPDFLoader
                pages = PyPDFLoader(tmp_path).load()
                text = "\n".join(p.page_content for p in pages)
            except Exception as e:
                print(f"⚠️ PyPDFLoader ({file_url}): {e}")
                try:
                    import pypdf
                    with open(tmp_path, "rb") as f:
                        reader = pypdf.PdfReader(f)
                        text = "\n".join(page.extract_text() or "" for page in reader.pages)
                except Exception as e2:
                    print(f"❌ pypdf fallback ({file_url}): {e2}")
        else:
            # DOC / DOCX
            try:
                import docx2txt
                text = docx2txt.process(tmp_path)
            except Exception as e:
                print(f"⚠️ docx2txt ({file_url}): {e}")
                # Fallback: витягуємо текст з бінарного .doc (CP1251)
                try:
                    raw = r.content.decode("cp1251", errors="ignore")
                    # Фільтруємо латинський/кириличний текст, прибираємо сміття
                    text = re.sub(r"[^\x20-\x7E\u0400-\u04FF\n\r\t]+", " ", raw)
                    text = re.sub(r" {4,}", " ", text).strip()
                except Exception as e2:
                    print(f"❌ DOC binary fallback ({file_url}): {e2}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    return text.strip()


# ── Завантаження одного документа ────────────────────────────────────────────

def process_ccu_doc(
    doc: dict,
    session_id: str | None = None,
    existing_ids: set | None = None,
) -> bool:
    """Обробляє один документ КСУ. Повертає True якщо успішно."""
    clean_id  = re.sub(r"[^\w]", "_", doc["doc_num"])
    law_id    = f"ccu_{clean_id}"

    if existing_ids and law_id in existing_ids:
        print(f"⏭️ Пропускаємо '{doc['doc_num']}' — вже є в базі")
        return None  # None = вже є, True = успіх, False = помилка

    # Знаходимо PDF URL: або прямий з таблиці, або через сторінку документа
    pdf_url = doc.get("pdf_url")
    if not pdf_url:
        doc_url = doc.get("doc_url")
        if doc_url:
            print(f"🔍 Шукаємо PDF на сторінці: {doc_url}")
            pdf_url = _get_pdf_url_from_doc_page(doc_url)
    if not pdf_url:
        print(f"⚠️ Не знайдено PDF для '{doc['doc_num']}'")
        return False

    text = _extract_pdf_text(pdf_url)
    if len(text) < 200:
        print(f"⚠️ Порожній текст для '{doc['doc_num']}' ({len(text)} символів) — пропускаємо. URL: {doc['pdf_url']}")
        return False

    # Визначаємо тип документа за номером
    if re.search(r"-р[/(\s]|-р$", doc["doc_num"], re.IGNORECASE):
        doc_type = "Рішення"
    elif re.search(r"-в[/(\s]|-в$", doc["doc_num"], re.IGNORECASE):
        doc_type = "Висновок"
    else:
        doc_type = "Інше"

    chunks      = text_splitter.split_text(text)
    scraped_at  = datetime.now(timezone.utc).isoformat()
    source_name = f"КСУ {doc_type}: {doc['doc_num']}"

    try:
        vectors = embed_v2.embed_documents(chunks, task="RETRIEVAL_DOCUMENT")
    except Exception as e:
        print(f"⚠️ CCU embed error: {e}")
        return False

    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        if vector is None:
            continue
        metadata = {
            "source":        source_name,
            "law_id":        law_id,
            "doc_num":       doc["doc_num"],
            "doc_type":      doc_type,
            "doc_date":      doc.get("date", ""),
            "author":        doc.get("author", ""),
            "category":      "Конституційний суд України",
            "law_url":       doc["pdf_url"],
            "source_domain": "ccu.gov.ua",
            "scraped_at":    scraped_at,
            "chunk_index":   i,
        }
        upload_to_qdrant(
            chunk_text, metadata, vector,
            collection_name="laws_ccu_v2",
            session_id=session_id,
        )

    print(f"✅ КСУ '{doc['doc_num']}' ({doc_type}) → laws_ccu_v2 ({len(chunks)} чанків)")
    return True


# ── Головний цикл синхронізації ───────────────────────────────────────────────

def run_ccu_sync(
    session_id: str | None = None,
    log_callback=None,
    pause_check=None,
    on_pause=None,
    start_index: int = 0,
    docs_cached: list | None = None,
) -> tuple[int, int]:
    """
    Синхронізує КСУ → laws_ccu.
    Повертає (ok_count, total_count).
    pause_check: callable() → bool, True = пауза.
    on_pause: callable(docs, next_idx, ok) — зберегти стан при паузі.
    start_index: індекс для resume.
    docs_cached: список документів для resume (щоб не парсити Раду знову).
    """
    def log(msg, level="info"):
        print(msg)
        if log_callback:
            log_callback(msg, level)

    if docs_cached and start_index > 0:
        docs = docs_cached
        log(f"▶️  Відновлення КСУ з індексу {start_index}")
    else:
        log("⚖️ Починаємо синхронізацію КСУ → laws_ccu...")
        log("🔍 Збираємо список рішень та висновків КСУ...")
        docs = get_all_ccu_docs(log=log)

    total = len(docs)
    log(f"📋 Після фільтрації: {total} документів (рішення + висновки)")

    existing_ids = get_existing_law_ids()
    log(f"📂 Вже в базі: {len(existing_ids)} документів")

    skipped = sum(1 for d in docs if existing_ids and f"ccu_{re.sub(r'[^\w]', '_', d['doc_num'])}" in existing_ids)
    log(f"🔄 Нових для обробки: {total - skipped} (вже в базі: {skipped})")

    ok = 0
    i = start_index
    while i < total:
        if pause_check and pause_check():
            if on_pause:
                on_pause(docs, i, ok)
            log(f"⏸️  Призупинено на {i}/{total}. Оброблено: {ok}", "warning")
            return ok, total

        batch_end = min(i + CCU_WORKERS, total)
        batch     = docs[i:batch_end]
        log(f"📥 Батч [{i + 1}–{batch_end}/{total}]: {', '.join(d['doc_num'] for d in batch)}")

        with ThreadPoolExecutor(max_workers=CCU_WORKERS) as pool:
            futs = {
                pool.submit(process_ccu_doc, doc,
                            session_id=session_id,
                            existing_ids=existing_ids): doc
                for doc in batch
            }
            for fut in as_completed(futs):
                doc = futs[fut]
                try:
                    result = fut.result()
                    if result is True:
                        ok += 1
                        log(f"  ✅ {doc['doc_num']} ({ok})", "success")
                    elif result is None:
                        log(f"  ⏭ {doc['doc_num']} — вже є в базі")
                    else:
                        log(f"  ⚠️ {doc['doc_num']} — порожній текст (PDF не розпізнано)", "warning")
                except Exception as e:
                    log(f"  ❌ {doc['doc_num']}: {e}", "error")

        i = batch_end
        time.sleep(1.0)

    log(f"✅ КСУ синхронізацію завершено. Додано/оновлено: {ok}/{total}.", "success")
    return ok, total


if __name__ == "__main__":
    run_ccu_sync()
