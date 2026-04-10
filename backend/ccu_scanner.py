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
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter
from rada_to_supabase import embeddings
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

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

        # Шукаємо PDF-посилання в останніх клітинках
        pdf_url = None
        for cell in cells:
            for a in cell.find_all("a", href=True):
                href = a["href"]
                if href.lower().endswith(".pdf"):
                    pdf_url = href if href.startswith("http") else CCU_BASE_URL + href
                    break
            if pdf_url:
                break

        if not pdf_url:
            continue  # без файлу — не потрібно

        docs.append({
            "doc_num":  doc_num,
            "date":     raw_date,
            "title":    title,
            "author":   author,
            "pdf_url":  pdf_url,
        })

    return docs


def get_total_pages() -> int:
    """Визначає кількість сторінок через пагінацію."""
    try:
        r = httpx.get(CCU_SEARCH_URL, params={"tid": "All", "page": "0"},
                      headers=HEADERS, timeout=30)
        soup = BeautifulSoup(r.text, "html.parser")
        pager = soup.find("ul", class_=re.compile(r"pager"))
        if not pager:
            return 1
        last = pager.find("li", class_=re.compile(r"pager-last"))
        if last:
            a = last.find("a", href=True)
            if a:
                m = re.search(r"page=(\d+)", a["href"])
                if m:
                    return int(m.group(1)) + 1
        # Fallback: рахуємо всі пронумеровані пункти
        nums = [int(a.get_text(strip=True))
                for li in pager.find_all("li")
                for a in li.find_all("a")
                if li.get_text(strip=True).isdigit()]
        return max(nums) + 1 if nums else 1
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

def _extract_pdf_text(pdf_url: str) -> str:
    """Завантажує PDF і повертає чистий текст."""
    try:
        r = httpx.get(pdf_url, headers=HEADERS, timeout=60, follow_redirects=True)
        r.raise_for_status()
    except Exception as e:
        print(f"❌ PDF download ({pdf_url}): {e}")
        return ""

    # Зберігаємо у tmp-файл і парсимо через langchain PyPDFLoader
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(r.content)
        tmp_path = tmp.name

    text = ""
    try:
        from langchain_community.document_loaders import PyPDFLoader
        loader = PyPDFLoader(tmp_path)
        pages = loader.load()
        text = "\n".join(p.page_content for p in pages)
    except Exception as e:
        print(f"⚠️ PyPDFLoader ({pdf_url}): {e}")
        # Fallback — спробуємо pypdf напряму
        try:
            import pypdf
            with open(tmp_path, "rb") as f:
                reader = pypdf.PdfReader(f)
                text = "\n".join(
                    page.extract_text() or "" for page in reader.pages
                )
        except Exception as e2:
            print(f"❌ pypdf fallback ({pdf_url}): {e2}")
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
        return True

    text = _extract_pdf_text(doc["pdf_url"])
    if len(text) < 200:
        print(f"⚠️ Порожній текст для '{doc['doc_num']}' — пропускаємо")
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

    for i, chunk_text in enumerate(chunks):
        vector   = embeddings.embed_query(chunk_text)
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
            collection_name="laws_ccu",
            session_id=session_id,
        )
        time.sleep(0.15)

    print(f"✅ КСУ '{doc['doc_num']}' ({doc_type}) → laws_ccu ({len(chunks)} чанків)")
    return True


# ── Головний цикл синхронізації ───────────────────────────────────────────────

def run_ccu_sync(
    session_id: str | None = None,
    log_callback=None,
    pause_check=None,
) -> tuple[int, int]:
    """
    Синхронізує КСУ → laws_ccu.
    Повертає (ok_count, total_count).
    pause_check: callable() → bool, True = пауза.
    """
    def log(msg):
        print(msg)
        if log_callback:
            log_callback(msg)

    log("⚖️ Починаємо синхронізацію КСУ → laws_ccu...")
    log("🔍 Збираємо список рішень та висновків КСУ...")

    docs = get_all_ccu_docs(log=log)
    total = len(docs)
    log(f"📋 Після фільтрації: {total} документів (рішення + висновки)")

    existing_ids = get_existing_law_ids()
    log(f"📂 Вже в базі: {len(existing_ids)} документів")

    ok = 0
    for i, doc in enumerate(docs):
        if pause_check and pause_check():
            log(f"⏸️  Призупинено на {i}/{total}. Оброблено: {ok}")
            return ok, total

        log(f"📥 [{i + 1}/{total}] {doc['doc_num']} — {doc['title'][:60]}")
        try:
            if process_ccu_doc(doc, session_id=session_id, existing_ids=existing_ids):
                ok += 1
                log(f"  ✅ Готово ({ok})")
            else:
                log(f"  ⏭ Пропущено")
        except Exception as e:
            log(f"  ❌ Помилка: {e}")
        time.sleep(1.5)

    log(f"✅ КСУ синхронізацію завершено. Додано/оновлено: {ok}/{total}.")
    return ok, total


if __name__ == "__main__":
    run_ccu_sync()
