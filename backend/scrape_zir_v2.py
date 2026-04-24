"""
scrape_zir_v2.py — Scraper for ZIR (zir.tax.gov.ua).
Загальнодоступний інформаційно-довідковий ресурс Державної податкової служби.
~5954 чинних Q&A (Питання-Відповідь) по податковому законодавству.

Pipeline:
  1. Playwright: відкрити сторінку → клікнути "Знайти" → зібрати всі ID + пагінація
     (результати завантажуються через AJAX results.txt — простий POST не дає всі 5954)
  2. requests + BeautifulSoup: GET кожної сторінки /main/bz/view/?src=ques&id={id}
  3. Зберігаємо: /root/laws_raw/zir/zir_{id}.txt + .meta.json

Запуск:
  python scrape_zir_v2.py --test      # перші 5 документів
  python scrape_zir_v2.py             # всі ~5954
"""
import os
import re
import sys
import json
import time
import argparse
import threading
import requests
from pathlib import Path
from datetime import datetime, timezone
from bs4 import BeautifulSoup

# ── Config ─────────────────────────────────────────────────────────────────────
RAW_DIR = os.environ.get("LAWS_RAW_DIR", "/root/laws_raw")
ZIR_DIR = os.path.join(RAW_DIR, "zir")
os.makedirs(ZIR_DIR, exist_ok=True)

BASE_URL    = "https://zir.tax.gov.ua"
SEARCH_URL  = f"{BASE_URL}/main/bz/search/?src=ques"
RESULTS_URL = f"{BASE_URL}/bz/view"           # AJAX endpoint для списку результатів
VIEW_URL    = f"{BASE_URL}/main/bz/view/?src=ques&id={{}}"

SLEEP_SEC   = 0.4   # пауза між запитами
MAX_RETRIES = 3

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk,en;q=0.9",
    "Referer": SEARCH_URL,
    "Content-Type": "application/x-www-form-urlencoded",
}

# ── Fetch list of all IDs via Playwright ──────────────────────────────────────
# Сайт завантажує результати через results.txt AJAX після кліку "Знайти".
# requests+POST бачить тільки 20 підказок (suggestion mode).
# Playwright клікає Знайти → чекає JS → збирає всі посилання + пагінація.

def _fetch_ids_via_requests(log=print) -> list[dict]:
    """
    Requests-based: POST пагінація через API ЗІР.
    Кожен запит повертає порцію результатів з посиланнями id=XXXXX.
    """
    items = []
    seen_ids: set[str] = set()
    start = 0
    PAGE_SIZE = 20
    empty_pages = 0

    log("  📡 Requests: пагінація через API ЗІР...")
    while True:
        payload = {
            "t": "getResultList", "wordsVal": "", "srcVal": "ques",
            "themeVal": "all", "checkedValue": "", "catVal": "0",
            "hrenVal": "all", "contVal": "cont-no",
            "statusVal": "1", "statusFOP": "all", "dateS": "", "dateE": "",
        }
        if start > 0:
            payload["start"] = start
        try:
            r = requests.post(RESULTS_URL, data=payload, headers=HEADERS, timeout=60)
            r.raise_for_status()
        except Exception as ex:
            log(f"  ⚠️ POST start={start}: {ex}")
            break

        # Шукаємо всі id= в HTML відповіді
        ids_found = re.findall(r'[?&]id=(\d+)', r.text)
        # Також шукаємо title у посиланнях
        soup = BeautifulSoup(r.text, "html.parser")
        links = soup.find_all("a", href=re.compile(r'id=\d+'))

        new_count = 0
        for link in links:
            href = link.get("href", "")
            m = re.search(r"id=(\d+)", href)
            if not m:
                continue
            item_id = m.group(1)
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            title = link.get_text(strip=True)[:200]
            items.append({"id": item_id, "title": title, "category": ""})
            new_count += 1

        # Якщо не знайшли посилань з href, шукаємо просто ID у тексті
        if new_count == 0:
            for item_id in ids_found:
                if item_id not in seen_ids:
                    seen_ids.add(item_id)
                    items.append({"id": item_id, "title": "", "category": ""})
                    new_count += 1

        log(f"  📄 start={start}: +{new_count} нових (всього {len(items)})")

        if new_count == 0:
            empty_pages += 1
            if empty_pages >= 2:
                break
        else:
            empty_pages = 0

        start += PAGE_SIZE
        time.sleep(0.2)

    return items


def _fetch_ids_via_playwright(log=print) -> list[dict]:
    """
    Playwright fallback: відкриваємо сторінку, тригеримо пошук кількома способами.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("❌ Playwright не встановлено")
        return []

    items = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(locale="uk-UA", user_agent=HEADERS["User-Agent"])
        page = ctx.new_page()

        log("  🌐 Playwright: відкриваємо ЗІР...")
        page.goto(SEARCH_URL, wait_until="networkidle", timeout=60_000)
        time.sleep(2)

        # Логуємо HTML для діагностики (перші 500 символів)
        snippet = page.evaluate("document.body.innerText.slice(0,300)")
        log(f"  📋 Сторінка (фрагмент): {snippet[:200]}")

        # Спроба 1: шукаємо submit-кнопку різними селекторами
        clicked = False
        for sel in [
            "input[type='submit']",
            "button[type='submit']",
            "input[value*='айти']",
            "button",
            "[onclick*='search']",
            "[onclick*='find']",
        ]:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.click()
                    clicked = True
                    log(f"  ✅ Clicked: {sel}")
                    break
            except Exception:
                pass

        # Спроба 2: submit форми через JS
        if not clicked:
            try:
                page.evaluate("document.querySelector('form') && document.querySelector('form').submit()")
                clicked = True
                log("  ✅ Form submitted via JS")
            except Exception as ex:
                log(f"  ⚠️ JS submit: {ex}")

        if clicked:
            try:
                page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception:
                pass
            time.sleep(3)

        # Збираємо всі посилання
        page_num = 1
        while True:
            links = page.query_selector_all("a[href*='id=']")
            found = 0
            for link in links:
                href = link.get_attribute("href") or ""
                if "src=ques" not in href and "bz/view" not in href:
                    continue
                m = re.search(r"id=(\d+)", href)
                if m and not any(x["id"] == m.group(1) for x in items):
                    title = link.inner_text().strip()[:200]
                    items.append({"id": m.group(1), "title": title, "category": ""})
                    found += 1

            log(f"  📄 Playwright сторінка {page_num}: +{found} нових (всього {len(items)})")

            next_btn = None
            for sel in ["a[title*='аступн']", "a:has-text('Наступна')", "a:has-text('»')",
                        f"a[href*='page={page_num + 1}']", ".pagination a:last-child"]:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        next_btn = el
                        break
                except Exception:
                    pass

            if not next_btn or found == 0:
                break

            next_btn.click()
            page.wait_for_load_state("networkidle", timeout=30_000)
            time.sleep(0.5)
            page_num += 1

        browser.close()

    return items


def fetch_all_ids(log=print) -> list[dict]:
    """
    Спочатку пробуємо requests-based пагінацію (надійніше на сервері).
    Якщо повертає 0 — Playwright fallback.
    """
    items = _fetch_ids_via_requests(log)
    if items:
        log(f"  ✅ Requests: зібрано {len(items)} питань")
        return items

    log("  ⚠️ Requests дав 0 — пробуємо Playwright...")
    items = _fetch_ids_via_playwright(log)
    log(f"  ✅ Playwright: зібрано {len(items)} питань")
    return items


# ── UNUSED — залишено для довідки про формат POST ─────────────────────────────
def _fetch_page_requests_unused(start: int = 0):
    """
    Не використовується: POST повертає тільки 20 suggestion-результатів.
    Залишено як довідка про параметри API.
    """
    payload = {
        "t": "getResultList", "wordsVal": "", "srcVal": "ques",
        "themeVal": "all", "checkedValue": "", "catVal": "0",
        "hrenVal": "all", "contVal": "cont-no",  # cont-no = всі результати
        "statusVal": "1", "statusFOP": "all", "dateS": "", "dateE": "",
        "start": start,
    }
    return requests.post(SEARCH_URL, data=payload, headers=HEADERS, timeout=60)



# ── Fetch individual Q&A page ──────────────────────────────────────────────────
def fetch_item(item_id: str) -> tuple[str, str, str]:
    """
    GET individual ZIR page → (question, answer, category).
    Сторінка SSR (server-side rendered) — Playwright не потрібен.
    """
    url = VIEW_URL.format(item_id)
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            break
        except Exception as ex:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(1.5)

    soup = BeautifulSoup(r.text, "html.parser")

    question = ""
    answer   = ""
    category = ""

    # Fieldsets мають клас ques / answ — шукаємо по class substring
    ques_field = soup.find("fieldset", class_=lambda c: c and "ques" in c.split())
    answ_field = soup.find("fieldset", class_=lambda c: c and "answ" in c.split())

    if ques_field:
        span = ques_field.find("span", attrs={"name": "eventName"})
        if span:
            question = span.get_text(separator="\n", strip=True)

    if answ_field:
        span = answ_field.find("span", attrs={"name": "eventName"})
        if span:
            answer = span.get_text(separator="\n", strip=True)

    # Категорія — шукаємо в breadcrumb або заголовку
    for sel in (".bz-category", ".bz_category", ".category", "h3", "h4",
                "[class*='categ']", "[class*='theme']"):
        el = soup.select_one(sel)
        if el:
            text = el.get_text(strip=True)
            if text and len(text) < 200:
                category = text
                break

    return question, answer, category


# ── Save ───────────────────────────────────────────────────────────────────────
def save_item(item_id: str, question: str, answer: str, meta: dict) -> None:
    final_text = f"ПИТАННЯ:\n{question}\n\nВІДПОВІДЬ:\n{answer}"
    Path(ZIR_DIR, f"zir_{item_id}.txt").write_text(final_text, encoding="utf-8")
    Path(ZIR_DIR, f"zir_{item_id}.meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── Entry point for server.py ──────────────────────────────────────────────────
def run_scrape_zir(log_callback=None, stop_event=None) -> None:
    _log  = log_callback or (lambda msg, lvl="info": print(msg))
    _stop = stop_event or threading.Event()

    _log("🔍 ЗІР: отримуємо список питань-відповідей...", "info")
    _log(f"   Директорія: {ZIR_DIR}", "info")

    try:
        items = fetch_all_ids(log=lambda msg: _log(msg, "info"))
    except Exception as ex:
        _log(f"❌ Не вдалося отримати список: {ex}", "error")
        return

    if not items:
        _log("❌ Список порожній — перевір API", "error")
        return

    _log(f"✅ Знайдено {len(items)} питань.", "info")

    ok = skip = err = 0

    for idx, item in enumerate(items, 1):
        if _stop.is_set():
            _log("⏸ Отримано сигнал зупинки.", "warning")
            break

        item_id = str(item["id"])
        txt_path = Path(ZIR_DIR, f"zir_{item_id}.txt")

        if txt_path.exists():
            skip += 1
            continue

        _log(f"  ⬇️  [{idx}/{len(items)}] ID {item_id}", "info")

        try:
            question, answer, category = fetch_item(item_id)
        except Exception as ex:
            _log(f"  ❌ [{idx}] fetch {item_id}: {ex}", "error")
            err += 1
            time.sleep(SLEEP_SEC)
            continue

        if not question and not answer:
            _log(f"  ⚠️  [{idx}] Порожній документ: {item_id}", "warning")
            err += 1
            continue

        meta = {
            "law_id":     f"zir_{item_id}",
            "title":      question[:200] if question else item.get("title", ""),
            "url":        VIEW_URL.format(item_id),
            "source":     "zir",
            "category":   category or item.get("category", ""),
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            save_item(item_id, question, answer, meta)
        except Exception as ex:
            _log(f"  ❌ [{idx}] save {item_id}: {ex}", "error")
            err += 1
            continue

        words = len(f"{question} {answer}".split())
        _log(f"       ✅ {words} слів", "info")
        ok += 1
        time.sleep(SLEEP_SEC)

    _log(f"{'='*50}", "info")
    _log(f"📊 ЗІР: ✅ {ok} збережено | ⏭ {skip} вже були | ❌ {err} помилок", "info")


# ── CLI ────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test",  action="store_true", help="Тільки перші 5")
    args = parser.parse_args()

    print(f"🔍 ЗІР скрапер v2\n   Директорія: {ZIR_DIR}\n")

    items = fetch_all_ids(log=print)
    if not items:
        print("❌ Список порожній")
        sys.exit(1)

    print(f"✅ Знайдено {len(items)} питань.")
    if args.test:
        items = items[:5]
        print(f"🧪 TEST MODE: {len(items)} документів\n")

    ok = skip = err = 0
    for idx, item in enumerate(items, 1):
        item_id = str(item["id"])
        if Path(ZIR_DIR, f"zir_{item_id}.txt").exists():
            print(f"  ⏭  [{idx}/{len(items)}] вже є: {item_id}")
            skip += 1
            continue

        print(f"  ⬇️  [{idx}/{len(items)}] ID {item_id}")
        try:
            question, answer, category = fetch_item(item_id)
            if not question and not answer:
                print(f"  ⚠️  Порожній: {item_id}")
                err += 1
                continue
            meta = {
                "law_id":     f"zir_{item_id}",
                "title":      question[:200] if question else item.get("title", ""),
                "url":        VIEW_URL.format(item_id),
                "source":     "zir",
                "category":   category or item.get("category", ""),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            }
            save_item(item_id, question, answer, meta)
            print(f"       ✅ {len(f'{question} {answer}'.split())} слів")
            ok += 1
        except Exception as ex:
            print(f"  ❌ {item_id}: {ex}")
            err += 1
        time.sleep(SLEEP_SEC)

    print(f"\n{'='*60}")
    print(f"📊 ✅ {ok} | ⏭ {skip} вже були | ❌ {err} помилок")
    print(f"   Файли у: {ZIR_DIR}")


if __name__ == "__main__":
    main()
