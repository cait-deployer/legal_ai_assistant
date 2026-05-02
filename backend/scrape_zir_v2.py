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

def _parse_quesids(html: str, items: list, seen_ids: set) -> int:
    """Витягує quesid з HTML, додає нові в items. Повертає кількість нових."""
    soup = BeautifulSoup(html, "html.parser")
    new_count = 0
    for row in soup.find_all(lambda t: t.name and t.get("quesid")):
        quesid = row.get("quesid")
        if not quesid or quesid in seen_ids:
            continue
        seen_ids.add(quesid)
        link = row.find("a")
        title = link.get_text(strip=True)[:200] if link else ""
        items.append({"id": quesid, "title": title, "category": ""})
        new_count += 1
    return new_count


def _fetch_ids_via_requests(log=print, max_batches: int | None = None) -> list[dict]:
    """
    Requests з сесією:
      1. GET сторінки (сесійні куки)
      2. POST getResultList → перші 20
      3. POST addToResultList → наступні 20, 40, ...
    max_batches — якщо задано, обмежує загальну кількість батчів (getResultList + addToResultList).
    """
    session = requests.Session()
    session.headers.update(HEADERS)

    log("  📡 Requests (session): отримуємо список ЗІР...")
    try:
        session.get(SEARCH_URL, timeout=30)
    except Exception as ex:
        log(f"  ⚠️ GET сторінки: {ex}")
        return []

    # Крок 1: перші результати
    payload_search = {
        "t": "getResultList", "wordsVal": "", "srcVal": "ques",
        "themeVal": "all", "checkedValue": "", "catVal": "0",
        "hrenVal": "all", "contVal": "cont-no",
        "statusVal": "1", "statusFOP": "all", "dateS": "", "dateE": "",
    }
    try:
        r = session.post(RESULTS_URL, data=payload_search, timeout=60)
        r.raise_for_status()
    except Exception as ex:
        log(f"  ⚠️ getResultList: {ex}")
        return []

    items: list[dict] = []
    seen_ids: set[str] = set()
    n = _parse_quesids(r.text, items, seen_ids)
    log(f"  📄 getResultList: +{n} (всього {len(items)})")

    if n == 0:
        return []

    batch_count = 1  # getResultList = перший батч
    if max_batches and batch_count >= max_batches:
        log(f"  🔍 recent_only: зупинено після {batch_count} батчів ({len(items)} питань)")
        return items

    # Крок 2: addToResultList — showMore() AJAX
    empty = 0
    while True:
        payload_more = {"t": "addToResultList", "srchWords": ""}
        try:
            r = session.post(RESULTS_URL, data=payload_more, timeout=60)
            r.raise_for_status()
        except Exception as ex:
            log(f"  ⚠️ addToResultList: {ex}")
            break

        new = _parse_quesids(r.text, items, seen_ids)
        batch_count += 1
        log(f"  📄 addToResultList batch {batch_count}: +{new} (всього {len(items)})")

        if max_batches and batch_count >= max_batches:
            log(f"  🔍 recent_only: зупинено після {batch_count} батчів ({len(items)} питань)")
            break

        if new == 0:
            empty += 1
            if empty >= 2:
                break
        else:
            empty = 0
        time.sleep(0.3)

    return items


def _fetch_ids_via_playwright(log=print, max_batches: int | None = None) -> list[dict]:
    """
    Playwright fallback: відкриваємо сторінку, тригеримо пошук кількома способами.
    max_batches — якщо задано, обмежує кількість батчів (включаючи початковий).
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

        # Пагінація через "Показати ще..." (div.show_more → showMore())
        seen_ids_pw: set[str] = set()
        batch = 0
        while True:
            # Збираємо всі нові quesid з DOM (showMore додає в кінець)
            rows = page.query_selector_all("div[quesid]")
            found = 0
            for row in rows:
                quesid = row.get_attribute("quesid") or ""
                if not quesid or quesid in seen_ids_pw:
                    continue
                seen_ids_pw.add(quesid)
                try:
                    link = row.query_selector("a")
                    title = link.inner_text().strip()[:200] if link else ""
                except Exception:
                    title = ""
                items.append({"id": quesid, "title": title, "category": ""})
                found += 1

            log(f"  📄 batch {batch}: +{found} нових (всього {len(items)})")

            if max_batches and batch + 1 >= max_batches:
                log(f"  🔍 recent_only: зупинено після {batch + 1} батчів ({len(items)} питань)")
                break

            # Шукаємо кнопку "Показати ще..."
            show_more = None
            for sel in ["div.show_more", "[onclick*='showMore']", ".show_more"]:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        show_more = el
                        break
                except Exception:
                    pass

            if not show_more:
                log("  ✅ Кнопку 'Показати ще' не знайдено — всі результати зібрано")
                break

            try:
                show_more.click()
                time.sleep(2)
                batch += 1
            except Exception as ex:
                log(f"  ⚠️ showMore click: {ex}")
                break

        browser.close()

    return items


def fetch_all_ids(log=print, max_batches: int | None = None) -> list[dict]:
    """
    Спочатку пробуємо requests-based пагінацію (надійніше на сервері).
    Якщо повертає 0 — Playwright fallback.
    max_batches — обмежує кількість батчів (20 питань/батч).
    """
    items = _fetch_ids_via_requests(log, max_batches=max_batches)
    if items:
        log(f"  ✅ Requests: зібрано {len(items)} питань")
        return items

    log("  ⚠️ Requests дав 0 — пробуємо Playwright...")
    items = _fetch_ids_via_playwright(log, max_batches=max_batches)
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
def run_scrape_zir(log_callback=None, stop_event=None, force: bool = False,
                   max_batches: int | None = None) -> None:
    _log  = log_callback or (lambda msg, lvl="info": print(msg))
    _stop = stop_event or threading.Event()

    _log("🔍 ЗІР: отримуємо список питань-відповідей...", "info")
    _log(f"   Директорія: {ZIR_DIR}" + (" [FORCE]" if force else "")
         + (f" [recent: {max_batches} батчів]" if max_batches else ""), "info")

    try:
        items = fetch_all_ids(log=lambda msg: _log(msg, "info"), max_batches=max_batches)
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

        if not force and txt_path.exists():
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
