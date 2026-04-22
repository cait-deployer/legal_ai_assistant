"""
scrape_all_v2.py — "Останній скрапер": зберігає тексти всіх законів на диск.
Після цього для зміни моделі достатньо запустити reindex_v2.py без повторного скрапінгу.

Джерела: rada, kmu, ccu, supreme, wiki
Зберігає: /root/laws_raw/{source}/{law_id}.txt + {law_id}.meta.json
Статуси:  /root/laws_raw/scrape_status.json

Запуск:
  python scrape_all_v2.py                  # всі джерела
  python scrape_all_v2.py --source rada    # тільки Rada
  python scrape_all_v2.py --reset          # почати заново (видаляє стан)
Зупинка: Ctrl+C  (стан зберігається автоматично)
"""
import os
import sys
import re
import json
import time
import signal
import tempfile
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────────
RAW_DIR     = os.environ.get("LAWS_RAW_DIR", "/root/laws_raw")
STATUS_FILE = os.path.join(RAW_DIR, "scrape_status.json")
STATE_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scrape_all_v2_state.json")
CACHE_TTL   = 48 * 3600   # 48h — кеш списку ID
WORKERS     = 4            # паралельні воркери для HTTP (Rada, KMU)
BATCH_SIZE  = 100          # скільки документів на батч ThreadPoolExecutor
SAVE_EVERY  = 50           # зберігати стан кожні N документів

SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki"]

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Shared state ───────────────────────────────────────────────────────────────
_stop        = threading.Event()
_log_cb      = None   # set by run_scrape_all()
_print_lock  = threading.Lock()
_status_lock = threading.Lock()

# Reverse mapping: collection → list of category codes (for Rada block filtering)
_COLLECTION_TO_CATEGORIES: dict[str, list[str]] = {}


def _log(msg: str, level: str = "info") -> None:
    if _log_cb:
        _log_cb(msg, level)
    else:
        with _print_lock:
            print(msg, flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── State / Status persistence ────────────────────────────────────────────────
def _load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            return json.loads(Path(STATE_FILE).read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    Path(STATE_FILE).write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


def _load_status() -> dict:
    if os.path.exists(STATUS_FILE):
        try:
            return json.loads(Path(STATUS_FILE).read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_status(status: dict) -> None:
    os.makedirs(RAW_DIR, exist_ok=True)
    Path(STATUS_FILE).write_text(json.dumps(status, ensure_ascii=False, indent=2), "utf-8")


# ── File helpers ───────────────────────────────────────────────────────────────
def _ensure_dir(source: str) -> str:
    d = os.path.join(RAW_DIR, source)
    os.makedirs(d, exist_ok=True)
    return d


def _save_law(source: str, law_id: str, text: str, meta: dict) -> None:
    d = _ensure_dir(source)
    Path(os.path.join(d, f"{law_id}.txt")).write_text(text, "utf-8")
    Path(os.path.join(d, f"{law_id}.meta.json")).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), "utf-8"
    )


# ── ID list cache ──────────────────────────────────────────────────────────────
def _cache_file(source: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), f"scrape_{source}_ids_cache.json")


def _load_cache(source: str) -> list | None:
    p = _cache_file(source)
    if not os.path.exists(p):
        return None
    try:
        data = json.loads(Path(p).read_text("utf-8"))
        if time.time() - data.get("ts", 0) < CACHE_TTL:
            return data["items"]
    except Exception:
        pass
    return None


def _save_cache(source: str, items: list) -> None:
    Path(_cache_file(source)).write_text(
        json.dumps({"ts": time.time(), "items": items}, ensure_ascii=False), "utf-8"
    )


# ── law_id computation (no HTTP) ──────────────────────────────────────────────
def _law_id_for(source: str, doc: dict) -> str:
    if source == "rada":
        return doc["id"]
    if source == "kmu":
        return f"kmu_{doc['id']}"
    if source == "ccu":
        return f"ccu_{re.sub(r'[^\\w]', '_', doc.get('doc_num', ''))}"
    if source == "supreme":
        filename = doc["url"].rstrip("/").split("/")[-1]
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in os.path.splitext(filename)[0])[:60]
        return f"sc_{safe}"
    if source == "wiki":
        return f"wiki_{re.sub(r'[^\\w]', '_', doc.get('title', ''))}"
    return "unknown"


# ── ID list fetchers ───────────────────────────────────────────────────────────
def _get_ids(source: str) -> list[dict]:
    cached = _load_cache(source)
    if cached is not None:
        _log(f"  Кеш: {len(cached)} ID ({source})")
        return cached

    _log(f"  ⏳ Завантажуємо список {source}... (може зайняти декілька хвилин)")

    if source == "rada":
        from rada_scanner import get_all_legal_ids
        items = get_all_legal_ids(log=_log)
    elif source == "kmu":
        from kmu_scanner import get_all_kmu_docs
        items = get_all_kmu_docs(log=_log)
    elif source == "ccu":
        from ccu_scanner import get_all_ccu_docs
        items = get_all_ccu_docs(log=_log)
    elif source == "supreme":
        from supreme_scanner import get_supreme_reviews
        items = get_supreme_reviews()
    elif source == "wiki":
        from wiki_scanner import get_all_wiki_articles
        items = get_all_wiki_articles()
    else:
        items = []

    _save_cache(source, items)
    _log(f"  {source}: {len(items)} документів (кеш збережено)")
    return items


# ── Text fetchers (one per source) ────────────────────────────────────────────
def _fetch_rada(doc: dict) -> tuple[str, str, dict]:
    from rada_scanner import get_law_text, BASE
    law_id = doc["id"]
    text   = get_law_text(law_id)
    meta   = {
        "law_id":   law_id,
        "title":    doc.get("title", ""),
        "source":   "rada",
        "category": doc.get("category", ""),
        "list_date": doc.get("list_date", ""),
        "law_url":  f"{BASE}/laws/show/{law_id}",
        "scraped_at": _now(),
    }
    return law_id, text, meta


def _fetch_kmu(doc: dict) -> tuple[str, str, dict]:
    from rada_scanner import get_law_text, BASE
    from kmu_scanner import _kmu_doc_type
    raw_id = doc["id"]
    law_id = f"kmu_{raw_id}"
    text   = get_law_text(raw_id)
    meta   = {
        "law_id":   law_id,
        "title":    doc.get("title", ""),
        "source":   "kmu",
        "doc_type": _kmu_doc_type(doc.get("title", ""), raw_id),
        "law_url":  f"{BASE}/laws/show/{raw_id}",
        "scraped_at": _now(),
    }
    return law_id, text, meta


def _fetch_ccu(doc: dict) -> tuple[str, str, dict]:
    from ccu_scanner import _extract_pdf_text, _get_pdf_url_from_doc_page
    doc_num = doc.get("doc_num", "")
    law_id  = f"ccu_{re.sub(r'[^\\w]', '_', doc_num)}"

    pdf_url = doc.get("pdf_url")
    if not pdf_url and doc.get("doc_url"):
        pdf_url = _get_pdf_url_from_doc_page(doc["doc_url"])

    text = _extract_pdf_text(pdf_url) if pdf_url else ""

    meta = {
        "law_id":   law_id,
        "title":    doc.get("title", ""),
        "source":   "ccu",
        "doc_num":  doc_num,
        "date":     doc.get("date", ""),
        "pdf_url":  pdf_url or "",
        "doc_url":  doc.get("doc_url", ""),
        "scraped_at": _now(),
    }
    return law_id, text, meta


def _fetch_supreme(doc: dict) -> tuple[str, str, dict]:
    import httpx
    url      = doc["url"]
    filename = url.rstrip("/").split("/")[-1]
    safe     = "".join(c if c.isalnum() or c in "-_" else "_" for c in os.path.splitext(filename)[0])[:60]
    law_id   = f"sc_{safe}"

    text = ""
    time.sleep(3)  # Supreme blocks fast requests
    try:
        r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60, follow_redirects=True)
        r.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(r.content)
            tmp_path = tmp.name
        try:
            from langchain_community.document_loaders import PyPDFLoader
            pages = PyPDFLoader(tmp_path).load()
            text  = "\n".join(p.page_content for p in pages)
        except Exception as ex:
            _log(f"  ⚠️ PyPDFLoader {law_id}: {ex}")
            try:
                import pypdf
                with open(tmp_path, "rb") as f:
                    reader = pypdf.PdfReader(f)
                    text   = "\n".join(pg.extract_text() or "" for pg in reader.pages)
            except Exception:
                pass
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except Exception as ex:
        _log(f"  ❌ Supreme fetch {law_id}: {ex}")

    meta = {
        "law_id":  law_id,
        "title":   doc.get("title", ""),
        "source":  "supreme",
        "pdf_url": url,
        "scraped_at": _now(),
    }
    return law_id, text, meta


def _fetch_wiki(doc: dict) -> tuple[str, str, dict]:
    import httpx
    from bs4 import BeautifulSoup
    title  = doc["title"]
    law_id = f"wiki_{re.sub(r'[^\\w]', '_', title)}"

    text = ""
    try:
        params = {
            "action": "parse", "page": title,
            "prop": "text", "format": "json", "disableeditsection": 1,
        }
        r = httpx.get("https://legalaid.wiki/api.php", params=params,
                      headers={"User-Agent": "LawyerAssistantBot/1.0"}, timeout=20)
        html = r.json().get("parse", {}).get("text", {}).get("*", "")
        if html:
            soup = BeautifulSoup(html, "html.parser")
            for junk in soup.find_all(["table", "div"], class_=["toc", "mw-empty-elt", "navbox"]):
                junk.decompose()
            text = soup.get_text(separator="\n", strip=True)
            cyrillic = len(re.findall(r"[а-яА-ЯіїєёІЇЄЁ]", text))
            if len(text) > 0 and cyrillic / len(text) < 0.3:
                text = ""  # not Ukrainian
        time.sleep(1)
    except Exception as ex:
        _log(f"  ⚠️ Wiki fetch {law_id}: {ex}")

    meta = {
        "law_id": law_id,
        "title":  title,
        "source": "wiki",
        "url":    doc.get("url", ""),
        "scraped_at": _now(),
    }
    return law_id, text, meta


_FETCHERS = {
    "rada":    _fetch_rada,
    "kmu":     _fetch_kmu,
    "ccu":     _fetch_ccu,
    "supreme": _fetch_supreme,
    "wiki":    _fetch_wiki,
}


# ── Process single document ───────────────────────────────────────────────────
def _process_one(source: str, doc: dict, status: dict) -> str:
    """Returns: ok | empty | restricted | error | skipped"""
    law_id = _law_id_for(source, doc)

    with _status_lock:
        if status.get(law_id, {}).get("status") == "ok":
            return "skipped"

    try:
        _law_id, text, meta = _FETCHERS[source](doc)
    except Exception as ex:
        _log(f"  ❌ {source}/{law_id}: {ex}")
        with _status_lock:
            status[law_id] = {"source": source, "status": "error", "scraped_at": _now(), "reason": str(ex)}
        return "error"

    if text == "__RESTRICTED__":
        st = "restricted"
    elif not text or len(text.strip()) < 50:
        st = "empty"
        if text and len(text.strip()) > 0:
            _log(f"  ⚠️ {source}/{law_id}: дуже короткий текст ({len(text.strip())} симв.)")
    else:
        st = "ok"
        _save_law(source, law_id, text, meta)

    entry: dict = {
        "source":         source,
        "status":         st,
        "scraped_at":     meta.get("scraped_at", _now()),
        "title":          meta.get("title", ""),
        "effective_date": meta.get("effective_date", ""),
    }
    if st != "ok":
        entry["reason"] = "restricted" if st == "restricted" else f"len={len(text.strip())}"

    with _status_lock:
        status[law_id] = entry

    return st


# ── Process one source ─────────────────────────────────────────────────────────
def _process_source(source: str, items: list, start_idx: int, state: dict, status: dict) -> None:
    stats = state["stats"][source]
    total = len(items)
    processed = 0

    use_threads = source in ("rada", "kmu")

    _ST_ICON = {"ok": "✅", "empty": "⚠️", "restricted": "🔒", "error": "❌", "skipped": "⏭️"}

    if use_threads:
        i = start_idx
        while i < total and not _stop.is_set():
            batch_end = min(i + BATCH_SIZE, total)
            batch     = list(enumerate(items[i:batch_end], start=i))

            with ThreadPoolExecutor(max_workers=WORKERS) as ex:
                futs = {ex.submit(_process_one, source, doc, status): (j, doc) for j, doc in batch}
                for fut in as_completed(futs):
                    j, doc = futs[fut]
                    law_id = _law_id_for(source, doc)
                    try:
                        st = fut.result()
                    except Exception as ex2:
                        _log(f"  ❌ [{j+1}/{total}] {law_id}: {ex2}", "error")
                        st = "error"
                    stats[st] = stats.get(st, 0) + 1
                    processed += 1
                    icon = _ST_ICON.get(st, "?")
                    title = doc.get("title", "")[:60]
                    _log(f"  {icon} [{j+1}/{total}] {law_id} — {st}" + (f" | {title}" if title else ""))

            i = batch_end
            state["inner_idx"] = i
            _save_state(state)
            _save_status(status)
            _log(
                f"\n  📊 [{source}] {i}/{total} — "
                f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
                f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}\n"
            )
    else:
        for j in range(start_idx, total):
            if _stop.is_set():
                break
            doc    = items[j]
            law_id = _law_id_for(source, doc)
            st = _process_one(source, doc, status)
            stats[st] = stats.get(st, 0) + 1
            processed += 1
            state["inner_idx"] = j + 1
            icon = _ST_ICON.get(st, "?")
            title = doc.get("title", "")[:60]
            _log(f"  {icon} [{j+1}/{total}] {law_id} — {st}" + (f" | {title}" if title else ""))

            if processed % SAVE_EVERY == 0 or j + 1 >= total:
                _save_state(state)
                _save_status(status)
                _log(
                    f"\n  📊 [{source}] {j+1}/{total} — "
                    f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
                    f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}\n"
                )

    state["inner_idx"] = total
    _save_state(state)
    _save_status(status)
    _log(
        f"\n✅ [{source}] ЗАВЕРШЕНО: "
        f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
        f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}"
    )


# ── Internal run logic ────────────────────────────────────────────────────────
def _run_main(source: str | None = None, rada_collection: str | None = None) -> None:
    os.makedirs(RAW_DIR, exist_ok=True)

    state = _load_state()
    if not state:
        state = {
            "source_idx": 0,
            "inner_idx":  0,
            "stats": {s: {"ok": 0, "empty": 0, "restricted": 0, "error": 0, "skipped": 0} for s in SOURCES},
        }

    status = _load_status()

    sources_to_run = [source] if source else SOURCES

    for si, src in enumerate(SOURCES):
        if src not in sources_to_run:
            continue
        if not source and si < state.get("source_idx", 0):
            _log(f"⏭ Пропускаємо {src} (вже завершено)")
            continue

        _log(f"\n{'='*60}")
        _log(f"ДЖЕРЕЛО: {src.upper()}")
        _log(f"{'='*60}")

        state["source_idx"] = si

        items = _get_ids(src)
        _log(f"  Всього: {len(items)} документів")

        # Rada block filtering
        if src == "rada" and rada_collection is not None:
            try:
                from qdrant_storage import CATEGORY_TO_COLLECTION
                cats = [c for c, col in CATEGORY_TO_COLLECTION.items() if col == rada_collection]
                items = [it for it in items if it.get("category") in cats]
                _log(f"  Фільтр Рада: {rada_collection} ({len(cats)} категорій, {len(items)} документів)")
            except Exception as ex:
                _log(f"  ⚠️ Не вдалося застосувати фільтр Рада: {ex}", "warning")

        start_idx = 0
        if not source and si == state.get("source_idx", 0):
            start_idx = state.get("inner_idx", 0)
            if start_idx > 0:
                _log(f"  Відновлення з позиції {start_idx}/{len(items)}")

        _process_source(src, items, start_idx, state, status)

        if _stop.is_set():
            _log("\n⏸ Зупинено. Запусти знову для продовження.")
            break

        state["source_idx"] = si + 1
        state["inner_idx"]  = 0
        _save_state(state)

    if not _stop.is_set():
        _log("\n" + "=" * 60)
        _log("🎉 СКРАПІНГ ЗАВЕРШЕНО!")
        for s in SOURCES:
            st = state["stats"].get(s, {})
            _log(
                f"  {s:8s}: ok={st.get('ok',0):>6} skip={st.get('skipped',0):>6} "
                f"empty={st.get('empty',0):>5} restr={st.get('restricted',0):>4} err={st.get('error',0):>4}"
            )
        if os.path.exists(STATE_FILE):
            os.unlink(STATE_FILE)


def run_scrape_all(
    source: str | None = None,
    rada_collection: str | None = None,
    log_callback=None,
    stop_event: threading.Event | None = None,
) -> None:
    """Called from server.py. Runs in a daemon thread."""
    global _stop, _log_cb
    _stop   = stop_event if stop_event is not None else threading.Event()
    _log_cb = log_callback
    try:
        _run_main(source=source, rada_collection=rada_collection)
    finally:
        _log_cb = None


# ── Main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Скрапер всіх джерел v2")
    parser.add_argument("--source", choices=SOURCES, help="Тільки одне джерело")
    parser.add_argument("--reset", action="store_true", help="Скинути стан і почати заново")
    args = parser.parse_args()

    if args.reset and os.path.exists(STATE_FILE):
        os.unlink(STATE_FILE)
        _log("🔄 Стан скинуто.")

    def _on_signal(sig, frame):
        _log("\n⏸ Зупинка... (зберігаємо стан)")
        _stop.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    _run_main(source=args.source)


if __name__ == "__main__":
    main()
