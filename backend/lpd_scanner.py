"""
lpd_scanner.py — Скрапер правових позицій Верховного Суду України.
Джерело: https://lpd.court.gov.ua/
API:     https://lpd-api-prod.court.gov.ua/api/v1

Скрапимо всі активні правові позиції (~12 800 позицій):
  - Велика Палата Верховного Суду (ВП ВС)
  - Касаційний адміністративний суд (КАС ВС)
  - Касаційний цивільний суд (КЦС ВС)
  - Касаційний кримінальний суд (ККС ВС)
  - Касаційний господарський суд (КГС ВС)

Переваги над qdrant/laws_supreme:
  - Відформульовані правові позиції, а не сирі рішення
  - Пов'язані із конкретними справами та датами
  - Категоризовані по галузях права (3086 категорій)
  - Без PDF — чистий текст через JSON API
"""

import re
import time
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser

import httpx
from langchain_text_splitters import RecursiveCharacterTextSplitter
import embed_v2
from qdrant_storage import upload_to_qdrant, get_existing_law_ids

# ── Константи ─────────────────────────────────────────────────────────────────

LPD_API   = "https://lpd-api-prod.court.gov.ua/api/v1"
PAGE_SIZE = 100
WORKERS   = 5   # паралельні embed-потоки

HEADERS = {
    "User-Agent":   "Mozilla/5.0 (compatible; URAI-Bot/1.0; +https://urai.com.ua)",
    "Accept":       "application/json",
    "Content-Type": "application/json",
}

# Маппінг тегів API → скорочення суду
COURT_TAG_MAP: dict[str, str] = {
    "Велика Палата": "ВП ВС",
    "КЦС":           "КЦС ВС",
    "ККС":           "ККС ВС",
    "КАС":           "КАС ВС",
    "КГС":           "КГС ВС",
}

_http_sem   = threading.Semaphore(8)
text_splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200)


# ── HTML → текст ──────────────────────────────────────────────────────────────

class _Stripper(HTMLParser):
    """Прибирає Quill.js HTML-теги, зберігає текст і переноси."""
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str):
        self._parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "h1", "h2", "h3", "h4"):
            self._parts.append("\n")

    def get_text(self) -> str:
        raw = "".join(self._parts)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def strip_html(html: str) -> str:
    if not html:
        return ""
    s = _Stripper()
    s.feed(html)
    return s.get_text()


# ── Завантаження позицій ───────────────────────────────────────────────────────

def fetch_all_positions(log=None, max_pages: int | None = None) -> list[dict]:
    """
    Завантажує правові позиції через пагінацію /legal-position/recent (відсортовані від найновіших).
    max_pages — якщо задано, завантажує тільки перші N сторінок (для інкрементального режиму).
    Повертає список raw dict з полями API.
    """
    all_positions: list[dict] = []
    page = 1

    while True:
        if max_pages and page > max_pages:
            if log:
                log(f"  🔍 recent_only: зупиняємось після {max_pages} сторінок ({len(all_positions)} позицій)")
            break

        try:
            with _http_sem:
                r = httpx.post(
                    f"{LPD_API}/legal-position/recent",
                    json={"pager": {"page": page, "documentsOnPage": PAGE_SIZE}},
                    headers=HEADERS,
                    timeout=30,
                )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            if log:
                log(f"❌ LPD сторінка {page}: {e}", "error")
            break

        batch = data.get("data") or []
        if not batch:
            break  # кінець пагінації

        all_positions.extend(batch)

        if log and (page % 10 == 0 or page == 1):
            log(f"  📄 Сторінка {page}: завантажено {len(all_positions)} позицій")

        page += 1
        time.sleep(0.1)  # ввічлива затримка

    return all_positions


# ── Обробка однієї позиції ─────────────────────────────────────────────────────

def process_position(
    pos: dict,
    session_id: str | None,
    existing_ids: set | None,
) -> bool | None:
    """
    Обробляє одну правову позицію: текст → чанки → embed → Qdrant.
    Повертає:
      True  = успішно додано
      None  = вже є в базі (пропущено)
      False = помилка або порожній текст
    """
    pos_id = pos.get("id")
    if not pos_id:
        return False

    law_id = f"lpd_{pos_id}"
    if existing_ids and law_id in existing_ids:
        return None  # вже є

    # ── Текст ──────────────────────────────────────────────────────────────────
    text = strip_html(pos.get("text") or "")
    if len(text) < 50:
        print(f"⚠️  LPD #{pos_id}: порожній текст — пропускаємо")
        return False

    # ── Метадані ───────────────────────────────────────────────────────────────
    title       = (pos.get("title") or "").strip()
    approved_at = pos.get("approvedAt", "")
    updated_at  = pos.get("updatedAt",  "")

    tag         = pos.get("tag") or {}
    court_tag   = tag.get("title", "")
    court_abbr  = COURT_TAG_MAP.get(court_tag, court_tag or "ВС")

    cats            = pos.get("categories") or []
    category_titles = [c.get("title", "") for c in cats if c.get("title")]
    primary_category = category_titles[0] if category_titles else "Правові позиції ВС"

    documents    = pos.get("documents") or []
    case_numbers = [d.get("caseNumber", "") for d in documents if d.get("caseNumber")]

    # ── Чанкування ─────────────────────────────────────────────────────────────
    # Заголовок завжди в першому чанку — пошук знайде правильний документ
    full_text = f"{title}\n\n{text}" if title else text
    chunks    = text_splitter.split_text(full_text)

    scraped_at  = datetime.now(timezone.utc).isoformat()
    source_name = f"Правова позиція {court_abbr}: {title[:80]}" if title else f"Правова позиція {court_abbr} #{pos_id}"

    # ── Ембедінг v2 ───────────────────────────────────────────────────────────
    try:
        vectors = embed_v2.embed_documents(chunks, task="RETRIEVAL_DOCUMENT")
    except Exception as e:
        print(f"⚠️  LPD #{pos_id} embed error: {e}")
        return False

    # ── Запис у Qdrant v2 ─────────────────────────────────────────────────────
    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        if vector is None:
            continue
        metadata = {
            "source":        source_name,
            "law_id":        law_id,
            "lpd_id":        pos_id,
            "title":         title,
            "court_tag":     court_tag,
            "court_abbr":    court_abbr,
            "category":      primary_category,
            "categories":    ", ".join(category_titles[:5]),
            "case_numbers":  ", ".join(case_numbers[:5]),
            "approved_at":   approved_at,
            "updated_at":    updated_at,
            "doc_type":      "Правова позиція",
            "source_domain": "lpd.court.gov.ua",
            "law_url":       f"https://lpd.court.gov.ua/legal-position/{pos_id}",
            "scraped_at":    scraped_at,
            "chunk_index":   i,
        }
        upload_to_qdrant(
            chunk_text, metadata, vector,
            collection_name="laws_positions_v2",
            session_id=session_id,
        )

    print(f"✅ LPD #{pos_id} ({court_abbr}) → laws_positions_v2 ({len(chunks)} чанків)")
    return True


# ── Головний цикл ─────────────────────────────────────────────────────────────

def run_lpd_sync(
    session_id: str | None = None,
    log_callback=None,
    pause_check=None,
    on_pause=None,
    start_index: int = 0,
    positions_cached: list | None = None,
) -> tuple[int, int]:
    """
    Синхронізує lpd.court.gov.ua → laws_positions.
    Повертає (ok_count, total_count).

    pause_check:       callable() → bool, True = призупинити
    on_pause:          callable(positions, next_idx, ok) — зберегти стан
    start_index:       індекс позиції для resume
    positions_cached:  список позицій для resume (не завантажувати знову)
    """
    def log(msg: str, level: str = "info"):
        print(msg)
        if log_callback:
            log_callback(msg, level)

    # ── Завантаження або відновлення ──────────────────────────────────────────
    if positions_cached and start_index > 0:
        positions = positions_cached
        log(f"▶️  Відновлення LPD з індексу {start_index}/{len(positions)}")
    else:
        log("=" * 50)
        log("⚖️  LPD SYNC: правові позиції Верховного Суду")
        log("=" * 50)
        log("🔍 Завантажуємо список позицій з lpd.court.gov.ua...")
        positions = fetch_all_positions(log=log)

    total = len(positions)
    log(f"📋 Завантажено: {total} правових позицій")

    if total == 0:
        log("⚠️  Нічого для обробки — перевір доступність API", "warning")
        return 0, 0

    existing_ids = get_existing_law_ids()
    log(f"📂 Вже в базі: {len(existing_ids)} документів")

    new_count = sum(1 for p in positions if f"lpd_{p.get('id')}" not in existing_ids)
    log(f"🆕 Нових для обробки: {new_count} / {total}")

    # ── Основний цикл ─────────────────────────────────────────────────────────
    ok = 0
    i  = start_index

    while i < total:
        if pause_check and pause_check():
            if on_pause:
                on_pause(positions, i, ok)
            log(f"⏸️  Призупинено на {i}/{total}. Оброблено: {ok}", "warning")
            return ok, total

        batch_end = min(i + WORKERS, total)
        batch     = positions[i:batch_end]

        if i % 100 == 0 or i == start_index:
            log(f"📥 Прогрес: {i + 1}–{batch_end}/{total} (додано: {ok})")

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futs = {
                pool.submit(process_position, pos, session_id, existing_ids): pos
                for pos in batch
            }
            for fut in as_completed(futs):
                pos = futs[fut]
                try:
                    result = fut.result()
                    if result is True:
                        ok += 1
                    elif result is False:
                        log(f"  ⚠️  LPD #{pos.get('id')} — пропущено (порожній текст)", "warning")
                    # None = вже в базі, мовчимо
                except Exception as e:
                    log(f"  ❌ LPD #{pos.get('id')}: {e}", "error")

        i = batch_end
        time.sleep(0.2)

    log(f"✅ LPD синхронізацію завершено. Додано: {ok} нових / {total} усього.", "success")
    return ok, total


if __name__ == "__main__":
    run_lpd_sync()
