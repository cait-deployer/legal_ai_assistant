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
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
CACHE_TTL   = 7 * 24 * 3600   # 7 днів — кеш списку ID
WORKERS     = 4            # паралельні воркери для HTTP (Rada, KMU)
BATCH_SIZE  = 100          # скільки документів на батч ThreadPoolExecutor
SAVE_EVERY  = 50           # зберігати стан кожні N документів

SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions"]

sys.path.insert(0, BASE_DIR)

# ── Per-source state (supports parallel runs) ──────────────────────────────────
_tls        = threading.local()                         # _tls.source = поточне джерело в цьому треді
_log_cbs:   dict[str, object]           = {}            # source → log callback
_stop_evts: dict[str, threading.Event]  = {}            # source → stop event
_print_lock  = threading.Lock()
_status_lock = threading.Lock()


def _state_file(source: str) -> str:
    return os.path.join(BASE_DIR, f"scrape_v2_{source}_state.json")


def _log(msg: str, level: str = "info") -> None:
    src = getattr(_tls, "source", None)
    cb  = _log_cbs.get(src) if src else None
    if cb:
        cb(msg, level)
    else:
        with _print_lock:
            print(msg, flush=True)


def _should_stop() -> bool:
    src = getattr(_tls, "source", None)
    evt = _stop_evts.get(src)
    return evt is not None and evt.is_set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── State / Status persistence ────────────────────────────────────────────────
def _load_state(source: str) -> dict:
    sf = _state_file(source)
    if os.path.exists(sf):
        try:
            return json.loads(Path(sf).read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict, source: str) -> None:
    Path(_state_file(source)).write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


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
    txt_path  = Path(os.path.join(d, f"{law_id}.txt"))
    meta_path = Path(os.path.join(d, f"{law_id}.meta.json"))
    txt_path.parent.mkdir(parents=True, exist_ok=True)
    txt_path.write_text(text, "utf-8")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")


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
def _wiki_slug(title: str) -> str:
    """
    Short unique slug for wiki law_id. Uses MD5 hash of full title so:
    - always fits in any filename limit
    - guaranteed unique (no collisions between different articles)
    - full title is stored separately in meta["title"]
    """
    import hashlib
    h = hashlib.md5(title.encode("utf-8")).hexdigest()[:16]
    return h


def _ccu_doc_type(doc_num: str) -> str:
    dn = doc_num.strip()
    if re.search(r'-р$', dn, re.IGNORECASE):
        return "Рішення"
    if re.search(r'-в$', dn, re.IGNORECASE):
        return "Висновок"
    return "Інше"


def _law_id_for(source: str, doc: dict) -> str:
    if source == "rada":
        return doc["id"]
    if source == "kmu":
        return f"kmu_{doc['id']}"
    if source == "ccu":
        return f"ccu_{re.sub(r'[^\w]', '_', doc.get('doc_num', ''))}"
    if source == "supreme":
        filename = doc["url"].rstrip("/").split("/")[-1]
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in os.path.splitext(filename)[0])[:60]
        return f"sc_{safe}"
    if source == "wiki":
        return f"wiki_{_wiki_slug(doc.get('title', ''))}"
    if source == "positions":
        return f"lpd_{doc.get('id', 'unknown')}"
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
    elif source == "positions":
        from lpd_scanner import fetch_all_positions
        items = fetch_all_positions(log=_log)
    else:
        items = []

    _save_cache(source, items)
    _log(f"  {source}: {len(items)} документів (кеш збережено)")
    return items


# ── Text fetchers (one per source) ────────────────────────────────────────────
def _fetch_rada(doc: dict) -> tuple[str, str, dict]:
    from rada_scanner import get_law_text, get_law_metadata, detect_text_flags, BASE
    from concurrent.futures import ThreadPoolExecutor
    law_id = doc["id"]
    with ThreadPoolExecutor(max_workers=2) as ex:
        ft = ex.submit(get_law_text, law_id)
        fm = ex.submit(get_law_metadata, law_id)
        text     = ft.result()
        law_meta = fm.result()
    flags = detect_text_flags(text) if text and text != "__RESTRICTED__" else {}
    meta = {
        "law_id":        law_id,
        "title":         doc.get("title", ""),
        "source":        "rada",
        "category":      doc.get("category", ""),
        "effective_date": law_meta.get("effective_date") or doc.get("list_date", ""),
        "law_url":       f"{BASE}/laws/show/{law_id}",
        "status":        law_meta.get("status", ""),
        "doc_number":    law_meta.get("doc_number", ""),
        "doc_type":      law_meta.get("doc_type", ""),
        "author":        law_meta.get("author", ""),
        "date_adopted":  law_meta.get("date_adopted", ""),
        "scraped_at":    _now(),
        **flags,
    }
    return law_id, text, meta


def _fetch_kmu(doc: dict) -> tuple[str, str, dict]:
    from rada_scanner import get_law_text, get_law_metadata, detect_text_flags, BASE
    from concurrent.futures import ThreadPoolExecutor
    from kmu_scanner import _kmu_doc_type
    raw_id   = doc["id"]
    law_id   = f"kmu_{raw_id}"
    doc_type = _kmu_doc_type(doc.get("title", ""), raw_id)
    with ThreadPoolExecutor(max_workers=2) as ex:
        ft = ex.submit(get_law_text, raw_id)
        fm = ex.submit(get_law_metadata, raw_id)
        text     = ft.result()
        law_meta = fm.result()
    flags = detect_text_flags(text) if text and text != "__RESTRICTED__" else {}
    meta = {
        "law_id":        law_id,
        "title":         doc.get("title", ""),
        "source":        "kmu",
        "doc_type":      doc_type,
        "category":      doc_type,
        "law_url":       f"{BASE}/laws/show/{raw_id}",
        "status":        law_meta.get("status", ""),
        "doc_number":    law_meta.get("doc_number", ""),
        "author":        law_meta.get("author", ""),
        "date_adopted":  law_meta.get("date_adopted", ""),
        "effective_date": law_meta.get("effective_date", ""),
        "scraped_at":    _now(),
        **flags,
    }
    return law_id, text, meta


def _fetch_ccu(doc: dict) -> tuple[str, str, dict]:
    from ccu_scanner import _extract_pdf_text, _get_pdf_url_from_doc_page
    from rada_scanner import detect_text_flags
    doc_num  = doc.get("doc_num", "")
    law_id   = f"ccu_{re.sub(r'[^\w]', '_', doc_num)}"
    doc_type = _ccu_doc_type(doc_num)

    pdf_url = doc.get("pdf_url")
    if not pdf_url and doc.get("doc_url"):
        pdf_url = _get_pdf_url_from_doc_page(doc["doc_url"])

    text  = _extract_pdf_text(pdf_url) if pdf_url else ""
    flags = detect_text_flags(text) if text else {}

    doc_url  = doc.get("doc_url", "")
    law_url  = doc_url or pdf_url or ""
    date_val = doc.get("date", "")

    meta = {
        "law_id":        law_id,
        "title":         doc.get("title", ""),
        "source":        "ccu",
        "doc_number":    doc_num,
        "doc_type":      doc_type,
        "category":      "Конституційний суд України",
        "author":        doc.get("author", ""),
        "date_adopted":  date_val,
        "effective_date": date_val,
        "law_url":       law_url,
        "pdf_url":       pdf_url or "",
        "status":        "",
        "scraped_at":    _now(),
        **flags,
    }
    return law_id, text, meta


def _fetch_supreme(doc: dict) -> tuple[str, str, dict]:
    import httpx
    from rada_scanner import detect_text_flags
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

    flags = detect_text_flags(text) if text else {}

    meta = {
        "law_id":        law_id,
        "title":         doc.get("title", ""),
        "source":        "supreme",
        "doc_type":      "Огляд судової практики",
        "category":      "Судова практика",
        "author":        "Верховний Суд",
        "law_url":       url,
        "pdf_url":       url,
        "doc_number":    "",
        "date_adopted":  "",
        "effective_date": "",
        "status":        "",
        "scraped_at":    _now(),
        **flags,
    }
    return law_id, text, meta


def _fetch_wiki(doc: dict) -> tuple[str, str, dict]:
    import httpx
    from bs4 import BeautifulSoup
    title  = doc["title"]
    law_id = f"wiki_{_wiki_slug(title)}"

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
        "law_id":   law_id,
        "title":    title,
        "source":   "wiki",
        "url":      doc.get("url", ""),
        "law_url":  doc.get("url", ""),
        "category": "Роз'яснення та шаблони",
        "doc_type": "Стаття Wiki",
        "author":   "legalaid.wiki",
        "status":   "",
        "doc_number":    "",
        "date_adopted":  "",
        "effective_date": "",
        "scraped_at": _now(),
    }
    return law_id, text, meta


def _fetch_positions(doc: dict) -> tuple[str, str, dict]:
    from lpd_scanner import strip_html, COURT_TAG_MAP
    pos_id = doc.get("id")
    law_id = f"lpd_{pos_id}"

    text  = strip_html(doc.get("text") or "")
    title = (doc.get("title") or "").strip()

    tag        = doc.get("tag") or {}
    court_tag  = tag.get("title", "")
    court_abbr = COURT_TAG_MAP.get(court_tag, court_tag or "ВС")

    cats             = doc.get("categories") or []
    category_titles  = [c.get("title", "") for c in cats if c.get("title")]
    primary_category = category_titles[0] if category_titles else "Правові позиції ВС"

    documents    = doc.get("documents") or []
    case_numbers = [d.get("caseNumber", "") for d in documents if d.get("caseNumber")]

    approved_at = doc.get("approvedAt", "")

    meta = {
        "law_id":         law_id,
        "title":          title,
        "source":         "positions",
        "doc_type":       "Правова позиція",
        "category":       primary_category,
        "author":         court_abbr,
        "law_url":        f"https://lpd.court.gov.ua/legal-position/{pos_id}",
        "doc_number":     "",
        "date_adopted":   approved_at,
        "effective_date": approved_at,
        "status":         "",
        "case_numbers":   ", ".join(case_numbers[:5]),
        "court_tag":      court_tag,
        "court_abbr":     court_abbr,
        "scraped_at":     _now(),
    }
    return law_id, text, meta


_FETCHERS = {
    "rada":      _fetch_rada,
    "kmu":       _fetch_kmu,
    "ccu":       _fetch_ccu,
    "supreme":   _fetch_supreme,
    "wiki":      _fetch_wiki,
    "positions": _fetch_positions,
}

# Fields that must be non-empty in meta.json; if any are missing → re-scrape
_REQUIRED_META: dict[str, list[str]] = {
    "rada":      ["status", "doc_number", "effective_date", "doc_type"],
    "kmu":       ["status", "doc_number", "doc_type"],
    "ccu":       ["doc_type", "category"],
    "supreme":   ["category", "doc_type"],
    "positions": ["doc_type", "category", "law_url"],
}


def _meta_incomplete(source: str, law_id: str) -> bool:
    """True if saved meta.json is missing required fields → need re-scrape."""
    required = _REQUIRED_META.get(source)
    if not required:
        return False
    meta_path = Path(os.path.join(RAW_DIR, source, f"{law_id}.meta.json"))
    if not meta_path.exists():
        return True
    try:
        meta = json.loads(meta_path.read_text("utf-8"))
        return any(not meta.get(f) for f in required)
    except Exception:
        return True


# ── Process single document ───────────────────────────────────────────────────
def _process_one(source: str, doc: dict, status: dict, force: bool = False) -> str:
    """Returns: ok | empty | restricted | error | skipped"""
    law_id = _law_id_for(source, doc)

    if not force:
        with _status_lock:
            # Primary: status.json says "ok" and meta is complete
            if status.get(law_id, {}).get("status") == "ok" and not _meta_incomplete(source, law_id):
                status[law_id]["checked_at"] = _now()
                return "skipped"
            # Fallback: .txt file exists on disk — trust disk over missing status entry
            txt_path = Path(os.path.join(RAW_DIR, source, f"{law_id}.txt"))
            if txt_path.exists() and txt_path.stat().st_size > 50 and not _meta_incomplete(source, law_id):
                now = _now()
                if status.get(law_id, {}).get("status") != "ok":
                    # Heal status.json so next run is fast
                    status[law_id] = {
                        "source": source, "status": "ok",
                        "scraped_at": now, "title": "", "effective_date": "",
                        "checked_at": now,
                    }
                else:
                    status[law_id]["checked_at"] = now
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


# ── Worker wrapper — sets TLS so _log() routes to correct callback ──────────────
def _process_one_ctx(source: str, doc: dict, status: dict, force: bool = False) -> str:
    _tls.source = source
    return _process_one(source, doc, status, force=force)


# ── Process one source ─────────────────────────────────────────────────────────
def _process_source(source: str, items: list, start_idx: int, state: dict, status: dict, force: bool = False) -> None:
    stats = state["stats"]
    total = len(items)
    processed = 0
    session_error_docs: list[dict] = []  # errors from this run — for retry on stop

    use_threads = source in ("rada", "kmu")
    _ST_ICON = {"ok": "✅", "empty": "⚠️", "restricted": "🔒", "error": "❌", "skipped": "⏭️"}
    stopped = False

    if use_threads:
        i = start_idx
        while i < total and not _should_stop():
            batch_end = min(i + BATCH_SIZE, total)
            batch     = list(enumerate(items[i:batch_end], start=i))

            with ThreadPoolExecutor(max_workers=WORKERS) as ex:
                futs = {ex.submit(_process_one_ctx, source, doc, status, force): (j, doc) for j, doc in batch}
                for fut in as_completed(futs):
                    j, doc = futs[fut]
                    law_id = _law_id_for(source, doc)
                    try:
                        st = fut.result()
                    except Exception as ex2:
                        _log(f"  ❌ [{j+1}/{total}] {law_id}: {ex2}", "error")
                        st = "error"
                    if st == "error":
                        session_error_docs.append(doc)
                    stats[st] = stats.get(st, 0) + 1
                    processed += 1
                    icon = _ST_ICON.get(st, "?")
                    title = doc.get("title", "")[:60]
                    _log(f"  {icon} [{j+1}/{total}] {law_id} — {st}" + (f" | {title}" if title else ""))

            i = batch_end
            state["inner_idx"] = i
            _save_state(state, source)
            _save_status(status)
            _log(
                f"\n  📊 [{source}] {i}/{total} — "
                f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
                f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}\n"
            )

        stopped = _should_stop() and i < total
    else:
        for j in range(start_idx, total):
            if _should_stop():
                stopped = True
                break
            doc    = items[j]
            law_id = _law_id_for(source, doc)
            st = _process_one(source, doc, status, force=force)
            if st == "error":
                session_error_docs.append(doc)
            stats[st] = stats.get(st, 0) + 1
            processed += 1
            state["inner_idx"] = j + 1
            icon = _ST_ICON.get(st, "?")
            title = doc.get("title", "")[:60]
            _log(f"  {icon} [{j+1}/{total}] {law_id} — {st}" + (f" | {title}" if title else ""))

            if processed % SAVE_EVERY == 0 or j + 1 >= total:
                _save_state(state, source)
                _save_status(status)
                _log(
                    f"\n  📊 [{source}] {j+1}/{total} — "
                    f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
                    f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}\n"
                )

    # ── Retry session errors before stopping ────────────────────────────────────
    if stopped and session_error_docs:
        _log(
            f"\n🔄 [{source}] Повторна спроба {len(session_error_docs)} помилок перед зупинкою...",
            "warning",
        )
        stats["error"] = max(0, stats.get("error", 0) - len(session_error_docs))
        retry_fixed = 0
        for doc in session_error_docs:
            law_id = _law_id_for(source, doc)
            with _status_lock:
                status.pop(law_id, None)  # clear so _process_one retries
            st = _process_one(source, doc, status)
            stats[st] = stats.get(st, 0) + 1
            icon = _ST_ICON.get(st, "?")
            _log(f"  {icon} [retry] {law_id} — {st}")
            if st != "error":
                retry_fixed += 1
        _log(f"  🔄 Retry: {retry_fixed}/{len(session_error_docs)} виправлено")
        _save_state(state, source)
        _save_status(status)

    # ── Final state ─────────────────────────────────────────────────────────────
    if not stopped:
        state["inner_idx"] = total
        _save_state(state, source)
        _save_status(status)
        _log(
            f"\n✅ [{source}] ЗАВЕРШЕНО: "
            f"ok={stats.get('ok',0)} skip={stats.get('skipped',0)} "
            f"empty={stats.get('empty',0)} restr={stats.get('restricted',0)} err={stats.get('error',0)}"
        )


# ── Internal run logic (always single source) ─────────────────────────────────
def _run_main(source: str, rada_collection: str | None = None, force: bool = False) -> None:
    _tls.source = source
    os.makedirs(RAW_DIR, exist_ok=True)

    state = _load_state(source)
    if not state:
        state = {
            "inner_idx": 0,
            "stats": {"ok": 0, "empty": 0, "restricted": 0, "error": 0, "skipped": 0},
        }

    status = _load_status()

    _log(f"\n{'='*60}")
    _log(f"ДЖЕРЕЛО: {source.upper()}" + (" [FORCE]" if force else ""))
    _log(f"{'='*60}")

    items = _get_ids(source)
    _log(f"  Всього: {len(items)} документів")

    if source == "rada" and rada_collection is not None:
        try:
            from qdrant_storage import CATEGORY_TO_COLLECTION
            cats  = [c for c, col in CATEGORY_TO_COLLECTION.items() if col == rada_collection]
            items = [it for it in items if it.get("category") in cats]
            _log(f"  Фільтр Рада: {rada_collection} ({len(cats)} категорій, {len(items)} документів)")
        except Exception as ex:
            _log(f"  ⚠️ Не вдалося застосувати фільтр Рада: {ex}", "warning")

    start_idx = state.get("inner_idx", 0)
    if start_idx > 0:
        _log(f"  Відновлення з позиції {start_idx}/{len(items)}")

    _process_source(source, items, start_idx, state, status, force=force)

    if _should_stop():
        _log("\n⏸ Зупинено. Запусти знову для продовження.")
        return

    _log("\n🎉 СКРАПІНГ ЗАВЕРШЕНО!")
    sf = _state_file(source)
    if os.path.exists(sf):
        os.unlink(sf)


def run_scrape_all(
    source: str,
    rada_collection: str | None = None,
    log_callback=None,
    stop_event: threading.Event | None = None,
    force: bool = False,
) -> None:
    """Called from server.py for a SINGLE source. Runs in a daemon thread."""
    evt = stop_event if stop_event is not None else threading.Event()
    _log_cbs[source]   = log_callback
    _stop_evts[source] = evt
    _tls.source = source
    try:
        _run_main(source=source, rada_collection=rada_collection, force=force)
    finally:
        _log_cbs.pop(source, None)
        _stop_evts.pop(source, None)


# ── Main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Скрапер всіх джерел v2")
    parser.add_argument("--source", choices=SOURCES, help="Тільки одне джерело")
    parser.add_argument("--reset", action="store_true", help="Скинути стан і почати заново")
    args = parser.parse_args()

    sources_to_run = [args.source] if args.source else SOURCES

    if args.reset:
        status = _load_status()
        for src in sources_to_run:
            sf = _state_file(src)
            if os.path.exists(sf):
                os.unlink(sf)
                print(f"🔄 Стан скинуто для {src}.")
            before = len(status)
            status = {k: v for k, v in status.items() if v.get("source") != src}
            removed = before - len(status)
            if removed:
                print(f"🔄 Видалено {removed} записів з scrape_status.json для {src}.")
        _save_status(status)

    _stop_main = threading.Event()

    def _on_signal(sig, frame):
        print("\n⏸ Зупинка... (зберігаємо стан)")
        for evt in _stop_evts.values():
            evt.set()
        _stop_main.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    for src in sources_to_run:
        if _stop_main.is_set():
            break
        run_scrape_all(source=src, stop_event=_stop_main)


if __name__ == "__main__":
    main()
