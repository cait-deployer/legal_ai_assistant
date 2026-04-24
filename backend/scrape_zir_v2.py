"""
scrape_zir_v2.py — Scraper for ZIR (zir.tax.gov.ua).
Загальнодоступний інформаційно-довідковий ресурс Державної податкової служби.
~5954 чинних Q&A (Питання-Відповідь) по податковому законодавству.

Pipeline:
  1. POST /main/bz/search/?src=ques → отримуємо всі ID (JSON або HTML-fallback)
  2. GET /main/bz/view/?src=ques&id={id} → requests + BeautifulSoup (no Playwright!)
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

BASE_URL   = "https://zir.tax.gov.ua"
SEARCH_URL = f"{BASE_URL}/main/bz/search/?src=ques"
VIEW_URL   = f"{BASE_URL}/main/bz/view/?src=ques&id={{}}"

SLEEP_SEC   = 0.4   # пауза між запитами
MAX_RETRIES = 3

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk,en;q=0.9",
    "Referer": SEARCH_URL,
    "Content-Type": "application/x-www-form-urlencoded",
}

# Параметри POST-запиту для отримання списку (чинні Q&A, Питання-Відповіді)
LIST_PAYLOAD = {
    "t":            "getResultList",
    "wordsVal":     "",
    "srcVal":       "ques",
    "themeVal":     "all",
    "checkedValue": "",
    "catVal":       "0",
    "hrenVal":      "all",
    "contVal":      "cont-yes",
    "statusVal":    "1",    # тільки чинні
    "statusFOP":    "all",
    "dateS":        "",
    "dateE":        "",
}


# ── Fetch list of all IDs ───────────────────────────────────────────────────────
def _fetch_page(session: requests.Session, start: int = 0) -> requests.Response:
    payload = {**LIST_PAYLOAD, "start": start}
    for attempt in range(MAX_RETRIES):
        try:
            r = session.post(SEARCH_URL, data=payload, timeout=60)
            r.raise_for_status()
            return r
        except Exception as ex:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2)


def fetch_all_ids(log=print) -> list[dict]:
    """
    Отримати всі ID питань через POST API.
    Підтримує JSON-відповідь і HTML-fallback (якщо API повертає HTML).
    """
    session = requests.Session()
    session.headers.update(HEADERS)

    log("  📡 POST → ZIR API (отримуємо список питань)...")
    r = _fetch_page(session, start=0)

    items = []

    # --- Спроба 1: JSON-відповідь ---
    try:
        data = r.json()
        rows = None
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            # різні можливі ключі залежно від версії API
            for key in ("rows", "items", "data", "results", "list"):
                if key in data and isinstance(data[key], list):
                    rows = data[key]
                    break
            if rows is None and "id" in data:
                rows = [data]

        if rows is not None:
            for row in rows:
                row_id = row.get("id") or row.get("ID") or row.get("bz_id") or row.get("bz_ID")
                if row_id:
                    items.append({
                        "id":       str(row_id),
                        "title":    row.get("title") or row.get("name") or row.get("question") or "",
                        "category": row.get("category") or row.get("theme") or row.get("hren") or "",
                    })
            if items:
                log(f"  ✅ JSON: знайдено {len(items)} питань")
                return items
    except Exception:
        pass

    # --- Спроба 2: HTML — витягаємо посилання з відповіді ---
    soup = BeautifulSoup(r.text, "html.parser")

    # Метод A: посилання вигляду href="...src=ques&id=12345"
    for link in soup.select("a[href*='src=ques'][href*='id=']"):
        href = link.get("href", "")
        m = re.search(r"id=(\d+)", href)
        if m and not any(x["id"] == m.group(1) for x in items):
            items.append({
                "id":       m.group(1),
                "title":    link.get_text(strip=True)[:200],
                "category": "",
            })

    # Метод B: data-атрибути або js-рядки з ID
    if not items:
        for m in re.finditer(r'"id"\s*:\s*"?(\d+)"?', r.text):
            row_id = m.group(1)
            if not any(x["id"] == row_id for x in items):
                items.append({"id": row_id, "title": "", "category": ""})

    if items:
        log(f"  ✅ HTML-fallback: знайдено {len(items)} питань на першій сторінці")
        # Перевіряємо пагінацію — шукаємо загальну кількість
        total_match = re.search(r"Рядків знайдено[:\s]+(\d+)", r.text)
        total = int(total_match.group(1)) if total_match else len(items)
        page_size = len(items)

        if total > page_size and page_size > 0:
            log(f"  📄 Пагінація: всього {total}, по {page_size} на сторінку...")
            start = page_size
            while start < total:
                try:
                    r2 = _fetch_page(session, start=start)
                    soup2 = BeautifulSoup(r2.text, "html.parser")
                    found = 0
                    for link in soup2.select("a[href*='src=ques'][href*='id=']"):
                        href = link.get("href", "")
                        m2 = re.search(r"id=(\d+)", href)
                        if m2 and not any(x["id"] == m2.group(1) for x in items):
                            items.append({
                                "id":       m2.group(1),
                                "title":    link.get_text(strip=True)[:200],
                                "category": "",
                            })
                            found += 1
                    log(f"    start={start}: +{found} (всього {len(items)})")
                    if found == 0:
                        break
                    start += page_size
                    time.sleep(0.5)
                except Exception as ex:
                    log(f"  ⚠️ Пагінація помилка start={start}: {ex}")
                    break

    if not items:
        log("  ❌ Не вдалося витягти ID — перевір формат відповіді API")

    return items


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
