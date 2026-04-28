"""
URAI — Збагачення метаданих Rada + KMU через Rada OpenData API.

Три фази (без торкання скрапера і реіндексу):
  Phase 1: Завантажити картки з API → кеш на диску
  Phase 2: Побудувати reverse-dead index (хто кого скасовує)
  Phase 3: Записати збагачені поля у .meta.json (merge, не overwrite)

Запуск вручну:
  python enrich_opendata_meta.py [--source rada|kmu|all] [--force]

Запуск з сервера:
  run_enrich(log_callback, stop_event, sources, force)
"""

import argparse
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import requests

from rada_opendata import (
    BASE, HEADERS,
    DEAD_STATUSES, KLAS_MAP, ORG_MAP, PODIA_DEAD_IDS,
    STATUS_MAP, TAGS_MAP, TEMY_MAP, TYP_MAP,
    decode_hist, decode_links, find_dead_date, fmt_date,
)

RAW_BASE   = Path("/root/laws_raw")
BACKEND    = Path(__file__).parent


def _fetch_card(nreg: str) -> tuple[dict | None, str]:
    """
    Повертає (card, status) де status:
      "ok"        — картка знайдена
      "not_found" — HTTP 404 або нема поля nazva (нормально для KMU/нових docs)
      "rate_limit"— HTTP 429
      "timeout"   — таймаут з'єднання
      "error"     — інша мережева помилка
    """
    url = f"{BASE}/laws/card/{nreg}.json"
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        if r.status_code == 200:
            try:
                d = r.json()
                if "nazva" in d:
                    return d, "ok"
                return None, "not_found"
            except Exception:
                return None, "not_found"
        if r.status_code == 404:
            return None, "not_found"
        if r.status_code == 429:
            return None, "rate_limit"
        return None, f"http_{r.status_code}"
    except requests.exceptions.Timeout:
        return None, "timeout"
    except requests.exceptions.ConnectionError:
        return None, "connection"
    except Exception as e:
        return None, f"error:{type(e).__name__}"

CARDS_CACHE = BACKEND / "enrich_opendata_cards_cache.json"
STATE_FILE  = BACKEND / "enrich_opendata_state.json"

SLEEP_SEC      = 0.05
RETRY_SLEEP    = 30
CACHE_TTL_DAYS = 7
WORKERS        = 2     # паралельних потоків для Phase 1
SAVE_EVERY     = 250   # зберігати кеш кожні N запитів

# Типи зв'язків: A -> B з таким типом означає "A скасовує B"
DEAD_LINK_TYPES = {4, 7, 19, 22, 25, 29}
# 4=Скасовує документ, 7=Зупиняє дію/вето, 19=Визнає недійсним,
# 22=Визнає нечинним, 25=Припиняє дію, 29=Визнає нечинним крім окремих

SOURCES = ["rada", "kmu"]

_stop_event: threading.Event | None = None
_log_fn = print
_lock = threading.Lock()


def _log(msg: str, level: str = "info") -> None:
    with _lock:
        _log_fn(msg, level) if _log_fn != print else print(msg)


# ── Кеш карток ────────────────────────────────────────────────────────────────

def _load_cards_cache() -> dict:
    if CARDS_CACHE.exists():
        try:
            return json.loads(CARDS_CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_cards_cache(cache: dict) -> None:
    CARDS_CACHE.write_text(
        json.dumps(cache, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def _cache_fresh(entry: dict) -> bool:
    ts = entry.get("_fetched_at", "")
    if not ts:
        return False
    try:
        age = datetime.utcnow() - datetime.fromisoformat(ts)
        return age < timedelta(days=CACHE_TTL_DAYS)
    except Exception:
        return False


# ── State ─────────────────────────────────────────────────────────────────────

def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── nreg з диску ──────────────────────────────────────────────────────────────

def _get_all_nregs(sources: list[str]) -> list[tuple[str, str]]:
    """Повертає [(source, nreg), ...] для всіх .txt файлів на диску."""
    result = []
    for src in sources:
        src_dir = RAW_BASE / src
        if not src_dir.exists():
            _log(f"[enrich] Директорія не знайдена: {src_dir}", "warning")
            continue
        for p in sorted(src_dir.glob("*.txt")):
            nreg = p.stem
            if nreg and not nreg.startswith("_"):
                result.append((src, nreg))
    return result


def _api_nreg(src: str, nreg: str) -> str:
    """Повертає nreg для запиту до OpenData API (без source-prefix)."""
    if src == "kmu" and nreg.startswith("kmu_"):
        return nreg[4:]  # "kmu_p-12-2024" → "p-12-2024"
    return nreg


# ── Phase 1: Завантаження карток ──────────────────────────────────────────────

def _eta(started: float, done: int, total: int) -> str:
    if done == 0:
        return "?"
    elapsed = time.time() - started
    remaining = elapsed / done * (total - done)
    if remaining < 60:
        return f"{int(remaining)}с"
    if remaining < 3600:
        return f"{int(remaining // 60)}хв {int(remaining % 60)}с"
    return f"{int(remaining // 3600)}г {int((remaining % 3600) // 60)}хв"


def run_phase1(sources: list[str], force: bool = False) -> dict:
    """Завантажує картки API — WORKERS паралельних потоків."""
    cards_cache = _load_cards_cache()
    all_nregs   = _get_all_nregs(sources)
    total       = len(all_nregs)
    t0          = time.time()

    to_fetch = [(src, nreg) for src, nreg in all_nregs
                if not (cards_cache.get(_api_nreg(src, nreg)) and not force
                        and _cache_fresh(cards_cache.get(_api_nreg(src, nreg), {})))]
    skipped    = total - len(to_fetch)
    need_fetch = len(to_fetch)

    src_counts = {}
    for src, _ in to_fetch:
        src_counts[src] = src_counts.get(src, 0) + 1
    src_summary = " | ".join(f"{s}={n}" for s, n in src_counts.items())
    _log(
        f"[Phase 1] ▶ Документів: {total} | з кешу: {skipped} | завантажити: {need_fetch}"
        f" | потоків: {WORKERS} | ({src_summary})"
    )
    LOG_EVERY = max(50, need_fetch // 100) if need_fetch > 0 else 50  # ~100 log lines

    counters   = {"fetched": 0, "not_found": 0, "errors": 0, "done": 0, "first_shown": False}
    err_types: dict[str, int] = {}
    cache_lock = threading.Lock()

    def fetch_one(src: str, nreg: str) -> None:
        if _stop_event and _stop_event.is_set():
            return
        api_key = _api_nreg(src, nreg)  # "kmu_p-12-2024" → "p-12-2024"
        card = None
        result_status = "error:unknown"
        for attempt in range(3):
            card, result_status = _fetch_card(api_key)
            if result_status == "ok":
                time.sleep(SLEEP_SEC)
                break
            if result_status == "not_found":
                break
            if result_status == "rate_limit":
                _log(f"[Phase 1] Rate limit — чекаємо {RETRY_SLEEP}с...", "warning")
                time.sleep(RETRY_SLEEP)
            elif result_status in ("timeout", "connection") or result_status.startswith("http_"):
                if attempt < 2:
                    time.sleep(2)
                else:
                    _log(f"[Phase 1] ПОМИЛКА {api_key}: {result_status}", "error")
            else:
                if attempt == 2:
                    _log(f"[Phase 1] ПОМИЛКА {api_key}: {result_status}", "error")

        with cache_lock:
            if card:
                card["_fetched_at"] = datetime.utcnow().isoformat()
                card["_source"]     = src
                cards_cache[api_key] = card
                counters["fetched"] += 1
                if not counters["first_shown"]:
                    counters["first_shown"] = True
                    _log(
                        f"[Phase 1] Перший: {api_key} | статус={card.get('status','?')} | "
                        f"nazva={str(card.get('nazva',''))[:50]}"
                    )
            elif result_status == "not_found":
                cards_cache[api_key] = {"_fetched_at": datetime.utcnow().isoformat(),
                                        "_source": src, "_not_found": True}
                counters["not_found"] += 1
            else:
                cards_cache[api_key] = {"_fetched_at": datetime.utcnow().isoformat(),
                                        "_source": src, "_error": result_status}
                counters["errors"] += 1
                err_types[result_status] = err_types.get(result_status, 0) + 1

            counters["done"] += 1
            done = counters["done"]

            if done % SAVE_EVERY == 0:
                _save_cards_cache(cards_cache)

            if done % LOG_EVERY == 0 or done == need_fetch:
                pct      = round(done / need_fetch * 100)
                elapsed  = time.time() - t0
                speed    = round(done / elapsed, 1) if elapsed > 0 else 0
                eta_str  = _eta(t0, done, need_fetch)
                err_rate = round(counters["errors"] / max(done, 1) * 100, 1)
                err_summary = " ".join(f"{k}:{v}" for k, v in err_types.items()) or "0"
                _log(
                    f"[Phase 1] {done}/{need_fetch} ({pct}%)"
                    f" | ok={counters['fetched']} 404={counters['not_found']} err={counters['errors']}({err_rate}%)"
                    f" | {speed} doc/s | ETA {eta_str}"
                )

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_one, src, nreg): nreg for src, nreg in to_fetch}
        for f in as_completed(futures):
            if _stop_event and _stop_event.is_set():
                _log(f"[Phase 1] Зупинено після {counters['done']}/{need_fetch}", "warning")
                break
            try:
                f.result()
            except Exception as e:
                _log(f"[Phase 1] Unexpected: {e}", "error")

    _save_cards_cache(cards_cache)
    elapsed   = time.time() - t0
    fetched   = counters["fetched"]
    not_found = counters["not_found"]
    errors    = counters["errors"]
    err_summary = " ".join(f"{k}:{v}" for k, v in err_types.items()) or "none"
    avg_speed = round(need_fetch / elapsed, 1) if elapsed > 0 and need_fetch > 0 else 0
    _log(
        f"[Phase 1] ✓ Завершено за {int(elapsed//60)}хв {int(elapsed%60)}с"
        f" | ok={fetched} 404={not_found} err={errors}({err_summary})"
        f" | з_кешу={skipped} | всього={total} | {avg_speed} doc/s"
    )
    return {"fetched": fetched, "not_found": not_found, "errors": errors, "skipped": skipped, "total": total}


# ── Phase 2: Reverse dead index ────────────────────────────────────────────────

def run_phase2(cards_cache: dict) -> dict:
    """
    Будує:
      dokid_to_nreg:  {dokid_str: nreg}
      reverse_dead:   {target_dokid: [{cancelled_by, rel_name, rel_code}]}
    """
    t0 = time.time()
    dokid_to_nreg: dict[str, str] = {}
    reverse_dead:  dict[str, list] = {}

    valid_cards = {n: c for n, c in cards_cache.items() if not c.get("_not_found")}
    not_found   = len(cards_cache) - len(valid_cards)

    _log(f"[Phase 2] ▶ Карток у кеші: {len(cards_cache)} | валідних: {len(valid_cards)} | not_found: {not_found}")

    for nreg, card in valid_cards.items():
        dokid = str(card.get("dokid", ""))
        if dokid:
            dokid_to_nreg[dokid] = nreg

    _log(f"[Phase 2] Побудовано dokid→nreg: {len(dokid_to_nreg)} записів")

    cancels_total = 0
    docs_with_links = 0
    rel_type_counts: dict[int, int] = {}

    for nreg, card in valid_cards.items():
        links_str = str(card.get("links", "") or "")
        if not links_str:
            continue
        docs_with_links += 1
        for lnk in decode_links(links_str):
            try:
                rel_int = int(lnk.get("rel_code", -1))
            except (ValueError, TypeError):
                continue
            rel_type_counts[rel_int] = rel_type_counts.get(rel_int, 0) + 1
            if rel_int not in DEAD_LINK_TYPES:
                continue
            target_dokid = lnk["dokid"]
            if target_dokid not in reverse_dead:
                reverse_dead[target_dokid] = []
            reverse_dead[target_dokid].append({
                "cancelled_by": nreg,
                "rel_name":     lnk["rel_name"],
                "rel_code":     lnk["rel_code"],
            })
            cancels_total += 1

    unique_targets = len(reverse_dead)
    _log(f"[Phase 2] Документів з посиланнями: {docs_with_links}")

    top_types = sorted(rel_type_counts.items(), key=lambda x: -x[1])[:8]
    _log(f"[Phase 2] Топ типів зв'язків: { {k: v for k, v in top_types} }")
    elapsed2 = int(time.time() - t0)
    _log(
        f"[Phase 2] ✓ Завершено за {elapsed2}с | скасувань: {cancels_total}"
        f" | унікальних цілей: {unique_targets}"
    )

    # Показати кілька прикладів reverse_dead
    examples = list(reverse_dead.items())[:3]
    for dokid, entries in examples:
        target_nreg = dokid_to_nreg.get(dokid, f"dokid={dokid}")
        canceller   = entries[0]["cancelled_by"]
        rel_name    = entries[0]["rel_name"]
        _log(f"[Phase 2]   Приклад: {canceller} --[{rel_name}]--> {target_nreg}")

    return {"dokid_to_nreg": dokid_to_nreg, "reverse_dead": reverse_dead,
            "cancels_total": cancels_total, "unique_targets": unique_targets}


# ── Побудова збагачених полів ─────────────────────────────────────────────────

def _build_enriched(nreg: str, card: dict, reverse_dead: dict, dokid_to_nreg: dict) -> dict:
    """Повертає dict з полями rada_* для запису в .meta.json."""
    status_code = card.get("status", -1)
    typ_code    = str(card.get("typ", ""))
    orgid       = str(card.get("orgid", card.get("org", "")))
    dokid       = str(card.get("dokid", ""))

    typ_name = TYP_MAP.get(typ_code, f"тип_{typ_code}")
    org_name = ORG_MAP.get(orgid, f"орган_{orgid}")

    # is_dead: за статусом АБО за reverse-dead index
    is_dead_by_status = status_code in DEAD_STATUSES
    reverse_entries   = reverse_dead.get(dokid, [])
    is_dead_by_link   = bool(reverse_entries)
    is_dead           = is_dead_by_status or is_dead_by_link

    hist_dec   = decode_hist(card.get("hist", []))
    dead_since = find_dead_date(hist_dec, is_dead)

    # replaced_by: nreg замінника (тільки для мертвих)
    replaced_by = ""
    if is_dead:
        eds     = card.get("eds", [])
        last_ed = eds[0] if eds else {}
        pidstava = last_ed.get("pidstava", "") or card.get("pidstava", "")
        if pidstava:
            replaced_by = pidstava
        elif reverse_entries:
            replaced_by = reverse_entries[0]["cancelled_by"]

    cancelled_by_list = [e["cancelled_by"] for e in reverse_entries] or None

    # klasy → розшифровані класифікатори
    klasy_raw = str(card.get("klasy", "") or "")
    klasy_dec = (
        " | ".join(KLAS_MAP.get(k, k) for k in klasy_raw.split("|") if k)
        if klasy_raw else None
    )

    # temy → розшифрована тема (може бути pipe-separated)
    temy_id = str(card.get("temy", "") or "")
    if temy_id and "|" in temy_id:
        temy_dec = " | ".join(TEMY_MAP.get(t, t) for t in temy_id.split("|") if t)
    else:
        temy_dec = TEMY_MAP.get(temy_id) if temy_id else None

    # tags → ознака документа
    tags_raw    = card.get("tags", None)
    has_no_text = (tags_raw == 4)
    tags_name   = TAGS_MAP.get(str(tags_raw), None) if tags_raw is not None else None

    # types (всі типи документа)
    types_raw = str(card.get("types", "") or "")
    types_dec = (
        " | ".join(TYP_MAP.get(t, t) for t in types_raw.split("|") if t)
        if types_raw else None
    )

    return {
        # Статус
        "rada_status":             status_code,
        "rada_status_name":        STATUS_MAP.get(status_code, "Невідомо"),
        "rada_is_dead":            is_dead,
        "rada_is_dead_by_status":  is_dead_by_status,
        "rada_is_dead_by_link":    is_dead_by_link,
        "rada_no_text":            has_no_text,
        "rada_tags":               tags_name,
        # Ідентифікатори
        "rada_dokid":              int(dokid) if dokid.isdigit() else None,
        "rada_nreg":               card.get("nreg", nreg),
        "rada_minjust":            card.get("minjust", "") or None,
        "rada_n_vlas":             card.get("n_vlas", "") or None,
        # Тип і орган
        "rada_doc_type":           typ_name,
        "rada_doc_types":          types_dec,
        "rada_org":                org_name,
        "rada_org_id":             orgid or None,
        # Дати
        "rada_adopted_date":       fmt_date(card.get("pridat", "")),
        "rada_last_edition":       fmt_date(card.get("datred", "")),
        # Замінники і скасування
        "rada_replaced_by":        replaced_by or None,
        "rada_cancelled_by":       cancelled_by_list,
        "rada_dead_since":         dead_since or None,
        # Класифікація
        "rada_theme":              temy_dec,
        "rada_classifiers":        klasy_dec,
        "rada_editions_cnt":       card.get("edcnt", 0),
        # Назва і URL
        "rada_title":              card.get("nazva", "") or None,
        "rada_url":                f"https://zakon.rada.gov.ua/laws/show/{nreg}",
        # Службові
        "rada_enriched_at":        datetime.utcnow().isoformat(),
    }


# ── Phase 3: Запис у .meta.json ────────────────────────────────────────────────

def run_phase3(
    sources: list[str],
    cards_cache: dict,
    reverse_dead: dict,
    dokid_to_nreg: dict,
) -> dict:
    """Записує збагачені поля у .meta.json (merge, не overwrite)."""
    all_nregs = _get_all_nregs(sources)
    total     = len(all_nregs)
    updated = skipped = errors = dead_total = dead_by_link = dead_by_status = no_text = 0
    t0 = time.time()

    LOG_EVERY = max(100, total // 50)  # ~50 log lines
    _log(f"[Phase 3] ▶ Документів для обробки: {total} | джерела: {', '.join(sources)}")

    for i, (src, nreg) in enumerate(all_nregs):
        if _stop_event and _stop_event.is_set():
            _log(f"[Phase 3] Зупинено на {i}/{total}", "warning")
            break

        api_key = _api_nreg(src, nreg)
        card = cards_cache.get(api_key)
        if not card or card.get("_not_found"):
            skipped += 1
            continue

        try:
            meta_path = RAW_BASE / src / f"{nreg}.meta.json"
            existing: dict = {}
            if meta_path.exists():
                try:
                    existing = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            enriched = _build_enriched(api_key, card, reverse_dead, dokid_to_nreg)
            existing.update(enriched)
            meta_path.write_text(
                json.dumps(existing, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            updated += 1

            if enriched["rada_is_dead"]:
                dead_total += 1
            if enriched["rada_is_dead_by_link"]:
                dead_by_link += 1
            if enriched["rada_is_dead_by_status"]:
                dead_by_status += 1
            if enriched["rada_no_text"]:
                no_text += 1

            # Перший dead-by-link — покажемо як приклад
            if enriched["rada_is_dead_by_link"] and dead_by_link == 1:
                canceller = (enriched.get("rada_cancelled_by") or ["?"])[0]
                _log(
                    f"[Phase 3] Перший dead-by-link: {nreg} | "
                    f"скасовано документом: {canceller}"
                )

        except Exception as e:
            _log(f"[Phase 3] ПОМИЛКА {nreg}: {e}", "error")
            errors += 1

        if (i + 1) % LOG_EVERY == 0 or (i + 1) == total:
            pct      = round((i + 1) / total * 100)
            elapsed  = time.time() - t0
            speed    = round((i + 1) / elapsed, 1) if elapsed > 0 else 0
            eta_str  = _eta(t0, i + 1, total)
            err_rate = round(errors / max(i + 1, 1) * 100, 1)
            dead_pct = round(dead_total / max(updated, 1) * 100)
            _log(
                f"[Phase 3] {i+1}/{total} ({pct}%)"
                f" | записано={updated} skip={skipped} err={errors}({err_rate}%)"
                f" | мертвих={dead_total}({dead_pct}%) status={dead_by_status} link={dead_by_link}"
                f" | {speed} doc/s | ETA {eta_str}"
            )

    elapsed  = time.time() - t0
    pct_dead = round(dead_total / updated * 100) if updated else 0
    _log(
        f"[Phase 3] ✓ Завершено за {int(elapsed//60)}хв {int(elapsed%60)}с"
        f" | записано={updated} | пропущено={skipped} | помилок={errors}"
        f" | мертвих={dead_total}({pct_dead}%) stat={dead_by_status} link={dead_by_link} без_тексту={no_text}"
    )
    return {
        "updated":        updated,
        "skipped":        skipped,
        "errors":         errors,
        "dead_total":     dead_total,
        "dead_by_link":   dead_by_link,
        "dead_by_status": dead_by_status,
        "no_text":        no_text,
    }


# ── Головна функція ────────────────────────────────────────────────────────────

def run_enrich(
    log_callback=print,
    stop_event: threading.Event | None = None,
    sources: list[str] | None = None,
    force: bool = False,
) -> None:
    """Entry point для server.py. Запускається в окремому потоці."""
    global _stop_event, _log_fn
    _stop_event = stop_event
    _log_fn     = log_callback

    if sources is None:
        sources = SOURCES

    state: dict = _load_state()
    state.update({
        "running":    True,
        "phase":      "starting",
        "sources":    sources,
        "started_at": datetime.utcnow().isoformat(),
        "error":      None,
    })
    _save_state(state)

    try:
        _log(f"=== Збагачення метаданих: {', '.join(sources)} ===")

        # Phase 1
        _log("--- Phase 1: Завантаження карток з API ---")
        state["phase"] = "phase1"
        _save_state(state)
        p1 = run_phase1(sources, force=force)
        state["phase1_stats"] = p1
        _save_state(state)

        if _stop_event and _stop_event.is_set():
            _log("Зупинено після Phase 1", "warning")
            state.update({"running": False, "phase": "stopped"})
            _save_state(state)
            return

        # Phase 2
        _log("--- Phase 2: Побудова reverse-dead index ---")
        state["phase"] = "phase2"
        _save_state(state)
        cards_cache = _load_cards_cache()
        p2 = run_phase2(cards_cache)
        state["phase2_stats"] = {
            "cancels_total": p2["cancels_total"],
            "unique_targets": p2["unique_targets"],
        }
        _save_state(state)

        if _stop_event and _stop_event.is_set():
            _log("Зупинено після Phase 2", "warning")
            state.update({"running": False, "phase": "stopped"})
            _save_state(state)
            return

        # Phase 3
        _log("--- Phase 3: Запис у .meta.json ---")
        state["phase"] = "phase3"
        _save_state(state)
        p3 = run_phase3(sources, cards_cache, p2["reverse_dead"], p2["dokid_to_nreg"])
        state["phase3_stats"] = p3
        _save_state(state)

        state.update({
            "phase":        "done",
            "running":      False,
            "completed_at": datetime.utcnow().isoformat(),
        })
        _save_state(state)
        _log("=== Збагачення завершено ===")

    except Exception as e:
        _log(f"[enrich] КРИТИЧНА ПОМИЛКА: {e}", "error")
        state.update({"running": False, "phase": "error", "error": str(e)})
        _save_state(state)
        raise


# ── Standalone ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Збагачення метаданих Ради/КМУ")
    parser.add_argument("--source", choices=["rada", "kmu", "all"], default="all")
    parser.add_argument("--force", action="store_true", help="Ігнорувати кеш карток")
    args = parser.parse_args()

    srcs = SOURCES if args.source == "all" else [args.source]
    run_enrich(sources=srcs, force=args.force)
