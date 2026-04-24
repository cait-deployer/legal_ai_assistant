"""
scrape_mod_v2.py — Scraper for mod.gov.ua (Ministry of Defense of Ukraine).

Сайт — Next.js App Router з клієнтним рендерингом.
Список документів завантажується JS → потрібен Playwright.

Pipeline:
  1. Playwright: відкрити відфільтровану сторінку → зібрати всі slug + title + metadata
  2. Для кожного документу: відкрити сторінку → знайти ВСІ PDF посилання (наказ + додатки)
  3. Завантажити PDF → витягти текст (PyMuPDF / pypdf)
  4. Зліпити текст → Зберегти: /root/laws_raw/mod/{slug}.txt + .meta.json

Встановлення (перший раз):
  pip install playwright pymupdf
  playwright install chromium

Запуск:
  python scrape_mod_v2.py --test     # перші 5 документів
  python scrape_mod_v2.py            # всі ~208 документів
  python scrape_mod_v2.py --debug    # показати браузер (не headless)
"""
import os
import re
import sys
import json
import time
import argparse
import requests
from pathlib import Path
from datetime import datetime, timezone

# ── Config ─────────────────────────────────────────────────────────────────────
RAW_DIR  = os.environ.get("LAWS_RAW_DIR", "/root/laws_raw")
MOD_DIR  = os.path.join(RAW_DIR, "mod")
BASE_URL = "https://mod.gov.ua"

LIST_URL = (
    f"{BASE_URL}/diyalnist/normativno-pravova-baza"
    "?area=kadrova-diialnist%2Cfinansova-diialnist%2Cmainova-diialnist"
    "&type=nakazi%2Cporiadok%2Cmetodichni-materiali%2Cdovidkovi-materiali"
)

SLEEP_SEC     = 1.0
PDF_SLEEP_SEC = 1.5

REQ_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk,en;q=0.9",
}

os.makedirs(MOD_DIR, exist_ok=True)


# ── PDF extraction ──────────────────────────────────────────────────────────────
MIN_TEXT_CHARS = 100  # якщо текстовий шар < 100 символів → вважаємо скан


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """
    1) Спробуємо витягти текстовий шар (PyMuPDF → pypdf).
    2) Якщо текст порожній або занадто короткий — OCR через Tesseract.
    """
    text = _extract_text_layer(pdf_bytes)
    if len(text.strip()) >= MIN_TEXT_CHARS:
        return text

    # Fallback: OCR
    print(f"       🔍 Текстовий шар порожній → OCR (Tesseract)...")
    ocr_text = _ocr_pdf(pdf_bytes)
    if ocr_text.strip():
        return ocr_text

    print(f"       ⚠️  OCR також порожній (можливо зашифрований або пошкоджений PDF)")
    return text  # повертаємо що є (може бути порожнє)


def _extract_text_layer(pdf_bytes: bytes) -> str:
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = [_clean_page(p.get_text("text")) for p in doc]
        doc.close()
        return "\n\n".join(p for p in pages if p.strip())
    except Exception:
        pass
    try:
        import io
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [_clean_page(p.extract_text() or "") for p in reader.pages]
        return "\n\n".join(p for p in pages if p.strip())
    except Exception as ex:
        print(f"  ❌ PDF parse error: {ex}")
        return ""


def _ocr_pdf(pdf_bytes: bytes) -> str:
    """
    OCR через Tesseract. Потрібно:
      apt-get install -y tesseract-ocr tesseract-ocr-ukr poppler-utils
      pip install pdf2image pytesseract
    """
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
    except ImportError:
        print("       ⚠️  OCR недоступний: pip install pdf2image pytesseract")
        print("             apt-get install -y tesseract-ocr tesseract-ocr-ukr poppler-utils")
        return ""

    try:
        images = convert_from_bytes(pdf_bytes, dpi=200)
        pages = []
        for img in images:
            text = pytesseract.image_to_string(img, lang="ukr+rus", config="--psm 1")
            text = _clean_page(text)
            if text.strip():
                pages.append(text)
        return "\n\n".join(pages)
    except Exception as ex:
        print(f"       ❌ OCR error: {ex}")
        return ""


def _clean_page(text: str) -> str:
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if re.fullmatch(r"\d+", line):
            continue
        if re.search(r"Стор\.\s*\d+\s*(з|із)\s*\d+", line):
            continue
        if re.search(r"МІНІСТЕРСТВО ОБОРОНИ УКРАЇНИ$", line):
            continue
        lines.append(line)
    return "\n".join(lines)


# ── Playwright: collect document list ──────────────────────────────────────────
def fetch_docs_playwright(headless: bool = True) -> list[dict]:
    """
    Use Playwright to render the JS-heavy listing page and collect all documents.
    Returns list of {slug, title, url, category, doc_type, publish_date}.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌ Playwright не встановлено. Запусти:")
        print("   pip install playwright && playwright install chromium")
        sys.exit(1)

    docs = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=headless)
        ctx = browser.new_context(
            locale="uk-UA",
            user_agent=REQ_HEADERS["User-Agent"],
        )
        page = ctx.new_page()

        print(f"  🌐 Відкриваємо: {LIST_URL}")
        page.goto(LIST_URL, wait_until="networkidle", timeout=60_000)

        page.wait_for_selector("article, [class*='grid'] a[href*='/normativno-pravova-baza/']",
                               timeout=30_000)

        page_num = 1
        while True:
            links = page.query_selector_all("a[href*='/normativno-pravova-baza/']")
            found = 0
            for link in links:
                href = link.get_attribute("href") or ""
                if "?" in href or href.rstrip("/").endswith("normativno-pravova-baza"):
                    continue

                slug = href.rstrip("/").split("/")[-1]
                if not slug or any(d["slug"] == slug for d in docs):
                    continue

                title = link.inner_text().strip()
                card = link.query_selector("xpath=ancestor::article") or link
                tags = [t.inner_text().strip() for t in card.query_selector_all("[class*='tag'], [class*='badge']")]

                docs.append({
                    "slug":       slug,
                    "title":      title,
                    "url":        f"{BASE_URL}{href}" if href.startswith("/") else href,
                    "category":   tags[0] if tags else "",
                    "doc_type":   tags[1] if len(tags) > 1 else "",
                    "publish_date": "",
                })
                found += 1

            print(f"  📄 Сторінка {page_num} — {found} нових документів (всього: {len(docs)})")

            next_btn = page.query_selector("a[aria-label*='Next'], a[aria-label*='наступн'], button[aria-label*='Next']")
            if not next_btn or not next_btn.is_visible():
                next_page_link = page.query_selector(f"a[href*='page={page_num + 1}']")
                if not next_page_link:
                    break
                next_page_link.click()
            else:
                next_btn.click()

            page.wait_for_load_state("networkidle", timeout=30_000)
            page_num += 1
            time.sleep(0.5)

        browser.close()

    return docs


# ── Playwright: get ALL PDF URLs from document page ────────────────────────────
def get_pdf_urls_playwright(page, doc_url: str) -> list[str]:
    """Navigate to doc page and find ALL PDF links (main order + attachments)."""
    try:
        page.goto(doc_url, wait_until="networkidle", timeout=30_000)
    except Exception as ex:
        print(f"  ❌ navigate: {ex}")
        return []

    found_urls = set()

    # Method 1: direct <a href=".pdf"> or download button
    links = page.query_selector_all("a[href$='.pdf'], a[download]")
    for link in links:
        href = link.get_attribute("href")
        if href and ".pdf" in href.lower():
            full_url = f"{BASE_URL}{href}" if href.startswith("/") else href
            found_urls.add(full_url)

    # Method 2: scan __NEXT_DATA__ for PDF paths
    next_data_el = page.query_selector("script#__NEXT_DATA__")
    if next_data_el:
        try:
            data = json.loads(next_data_el.inner_text())
            text_dump = json.dumps(data)
            matches = re.findall(r'["\'](/[^"\']+\.pdf)["\']|["\'](https?://[^"\']+\.pdf)["\']', text_dump)
            for m in matches:
                path = m[0] or m[1]
                if path:
                    full_url = f"{BASE_URL}{path}" if path.startswith("/") else path
                    found_urls.add(full_url)
        except Exception:
            pass

    # Method 3: scan full page HTML fallback
    html = page.content()
    pdfs = re.findall(r'href=["\']([^"\']+\.pdf)["\']', html, re.IGNORECASE)
    for p in pdfs:
        full_url = f"{BASE_URL}{p}" if p.startswith("/") else p
        found_urls.add(full_url)

    return list(found_urls)


# ── Download PDF (requests, no JS needed) ─────────────────────────────────────
def download_pdf(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=REQ_HEADERS, timeout=60)
        r.raise_for_status()
        return r.content
    except Exception as ex:
        print(f"  ❌ PDF download: {ex}")
        return None


# ── Save ───────────────────────────────────────────────────────────────────────
def save_doc(slug: str, text: str, meta: dict) -> None:
    Path(MOD_DIR, f"{slug}.txt").write_text(text, encoding="utf-8")
    Path(MOD_DIR, f"{slug}.meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def normalize_meta(item: dict) -> dict:
    return {
        "law_id":        item["slug"],
        "source":        "mod_gov",
        "title":         item.get("title", ""),
        "url":           item.get("url", ""),
        "category":      item.get("category", ""),
        "doc_type":      item.get("doc_type", ""),
        "publish_date":  item.get("publish_date", ""),
        "scraped_at":    datetime.now(timezone.utc).isoformat(),
    }


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test",  action="store_true", help="Тільки перші 5 документів")
    parser.add_argument("--debug", action="store_true", help="Показати браузер (не headless)")
    args = parser.parse_args()

    headless = not args.debug
    print(f"🔍 Збираємо список документів МОУ (Playwright, headless={headless})...")
    print(f"   Директорія: {MOD_DIR}\n")

    docs = fetch_docs_playwright(headless=headless)

    if not docs:
        print("❌ Документів не знайдено.")
        sys.exit(1)

    print(f"\n✅ Знайдено {len(docs)} документів.")

    if args.test:
        docs = docs[:5]
        print(f"🧪 TEST MODE: обробляємо тільки {len(docs)}\n")

    ok = skip = err = 0

    try:
        from playwright.sync_api import sync_playwright
        pw_ctx = sync_playwright().start()
        browser = pw_ctx.chromium.launch(headless=headless)
        pw_page = browser.new_context(locale="uk-UA").new_page()
        use_playwright_pdf = True
    except Exception:
        use_playwright_pdf = False
        pw_ctx = browser = pw_page = None

    for idx, item in enumerate(docs, 1):
        meta = normalize_meta(item)
        slug = meta["law_id"]

        if Path(MOD_DIR, f"{slug}.txt").exists():
            print(f"  ⏭  [{idx}/{len(docs)}] вже є: {slug}")
            skip += 1
            continue

        title_short = meta["title"][:65] or slug
        print(f"  ⬇️  [{idx}/{len(docs)}] {title_short}")

        pdf_urls = []
        if use_playwright_pdf and pw_page:
            pdf_urls = get_pdf_urls_playwright(pw_page, meta["url"])
            time.sleep(SLEEP_SEC)

        if not pdf_urls:
            print(f"  ⚠️  PDF URL не знайдено: {slug}")
            err += 1
            continue

        print(f"       🔗 Знайдено PDF файлів: {len(pdf_urls)}")
        meta["pdf_urls"] = pdf_urls

        all_text_parts = []
        for p_url in pdf_urls:
            print(f"         ⬇️ Завантажую: ...{p_url[-45:]}")
            pdf_bytes = download_pdf(p_url)
            time.sleep(PDF_SLEEP_SEC)
            if not pdf_bytes:
                continue

            text_part = extract_pdf_text(pdf_bytes)
            if text_part.strip():
                all_text_parts.append(text_part.strip())

        if not all_text_parts:
            print(f"  ⚠️  Порожній текст з усіх PDF (можливо скани): {slug}")
            err += 1
            continue

        # Зліплюємо текст з усіх знайдених PDF-документів
        separator = "\n\n" + "="*50 + "\nНАСТУПНИЙ ДОКУМЕНТ / ДОДАТОК\n" + "="*50 + "\n\n"
        final_text = separator.join(all_text_parts)

        save_doc(slug, final_text, meta)
        print(f"       ✅ Збережено: {len(final_text.split())} слів (з {len(all_text_parts)} файлів)")
        ok += 1

    if browser:
        browser.close()
        pw_ctx.stop()

    print(f"\n{'='*60}")
    print(f"📊 Результат: ✅ {ok} | ⏭ {skip} вже були | ❌ {err} помилок")
    print(f"   Файли у: {MOD_DIR}")


def run_scrape_mod(
    log_callback=None,
    stop_event=None,
) -> None:
    """Entry point for server.py — runs full scrape (no --test mode)."""
    import threading

    _log = log_callback or (lambda msg, lvl="info": print(msg))
    _stop = stop_event or threading.Event()

    _log("🔍 Збираємо список документів МОУ (Playwright)...", "info")
    _log(f"   Директорія: {MOD_DIR}", "info")

    docs = fetch_docs_playwright(headless=True)
    if not docs:
        _log("❌ Документів не знайдено — перевір з'єднання або структуру сайту.", "error")
        return

    _log(f"✅ Знайдено {len(docs)} документів.", "info")

    ok = skip = err = 0
    pw_ctx = browser = pw_page = None
    try:
        from playwright.sync_api import sync_playwright
        pw_ctx = sync_playwright().start()
        browser = pw_ctx.chromium.launch(headless=True)
        pw_page = browser.new_context(locale="uk-UA").new_page()
    except Exception as ex:
        _log(f"❌ Playwright ініціалізація: {ex}", "error")
        return

    try:
        for idx, item in enumerate(docs, 1):
            if _stop.is_set():
                _log("⏸ Отримано сигнал зупинки.", "warning")
                break

            meta = normalize_meta(item)
            slug = meta["law_id"]

            if Path(MOD_DIR, f"{slug}.txt").exists():
                skip += 1
                continue

            title_short = (meta["title"] or slug)[:65]
            _log(f"  ⬇️  [{idx}/{len(docs)}] {title_short}", "info")

            pdf_urls = get_pdf_urls_playwright(pw_page, meta["url"])
            time.sleep(SLEEP_SEC)

            if not pdf_urls:
                _log(f"  ⚠️  PDF URL не знайдено: {slug}", "warning")
                err += 1
                continue

            _log(f"       🔗 PDF файлів: {len(pdf_urls)}", "info")
            meta["pdf_urls"] = pdf_urls

            all_text_parts = []
            for p_url in pdf_urls:
                if _stop.is_set():
                    break
                pdf_bytes = download_pdf(p_url)
                time.sleep(PDF_SLEEP_SEC)
                if not pdf_bytes:
                    continue
                try:
                    text_part = extract_pdf_text(pdf_bytes)
                except Exception as ex:
                    _log(f"  ⚠️  PDF parse error (пропускаємо): {ex}", "warning")
                    continue
                if text_part.strip():
                    all_text_parts.append(text_part.strip())

            if not all_text_parts:
                _log(f"  ⚠️  Порожній текст (можливо скани): {slug}", "warning")
                err += 1
                continue

            separator = "\n\n" + "=" * 50 + "\nНАСТУПНИЙ ДОКУМЕНТ / ДОДАТОК\n" + "=" * 50 + "\n\n"
            final_text = separator.join(all_text_parts)
            save_doc(slug, final_text, meta)
            words = len(final_text.split())
            _log(f"       ✅ Збережено: {words} слів (з {len(all_text_parts)} файлів)", "info")
            ok += 1

    finally:
        if browser:
            try:
                browser.close()
                pw_ctx.stop()
            except Exception:
                pass

    _log(f"\n{'='*50}", "info")
    _log(f"📊 МОУ: ✅ {ok} збережено | ⏭ {skip} вже були | ❌ {err} помилок", "info")


if __name__ == "__main__":
    main()