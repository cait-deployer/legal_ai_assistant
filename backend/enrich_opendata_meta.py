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
from datetime import datetime, timedelta
from pathlib import Path

import requests

from rada_opendata import (
    DEAD_STATUSES, KLAS_MAP, ORG_MAP, PODIA_DEAD_IDS,
    STATUS_MAP, TAGS_MAP, TEMY_MAP, TYP_MAP,
    decode_hist, decode_links, find_dead_date, fmt_date, get_card,
)

RAW_BASE   = Path("/root/laws_raw")
BACKEND    = Path(__file__).parent

CARDS_CACHE = BACKEND / "enrich_opendata_cards_cache.json"
STATE_FILE  = BACKEND / "enrich_opendata_state.json"

SLEEP_SEC      = 0.05
RETRY_SLEEP    = 30
CACHE_TTL_DAYS = 7
SAVE_EVERY     = 250   # зберігати кеш кожні N запитів
LOG_EVERY      = 50   # логувати прогрес кожні N запитів (~2 хв)

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
    """Завантажує картки API для всіх nreg → зберігає у кеш."""
    cards_cache = _load_cards_cache()
    all_nregs   = _get_all_nregs(sources)
    total       = len(all_nregs)
    fetched = errors = skipped = 0
    t0 = time.time()

    already_cached = sum(
        1 for _, nreg in all_nregs
        if cards_cache.get(nreg) and not force and _cache_fresh(cards_cache.get(nreg, {}))
    )
    need_fetch = total - already_cached

    _log(f"[Phase 1] Документів на диску: {total} | в кеші: {already_cached} | потрібно завантажити: {need_fetch}")
    _log(f"[Phase 1] Швидкість: ~{SLEEP_SEC}с/запит → приблизно {int(need_fetch * SLEEP_SEC / 60)} хв")

    for i, (src, nreg) in enumerate(all_nregs):
        if _stop_event and _stop_event.is_set():
            _log(f"[Phase 1] Зупинено на {i}/{total}", "warning")
            break

        cached = cards_cache.get(nreg)
        if cached and not force and _cache_fresh(cached):
            skipped += 1
            continue

        card = None
        for attempt in range(3):
            try:
                card = get_card(nreg)
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "Too Many" in err_str:
                    _log(f"[Phase 1] Rate limit — чекаємо {RETRY_SLEEP}с...", "warning")
                    time.sleep(RETRY_SLEEP)
                elif attempt == 2:
                    _log(f"[Phase 1] ПОМИЛКА {nreg}: {e}", "error")

        if card:
            card["_fetched_at"] = datetime.utcnow().isoformat()
            card["_source"]     = src
            cards_cache[nreg]   = card
            fetched += 1

            # перший успішний — покажемо що отримали
            if fetched == 1:
                _log(
                    f"[Phase 1] Перший документ: {nreg} | "
                    f"статус={card.get('status','?')} | "
                    f"тип={card.get('typ','?')} | "
                    f"nazva={str(card.get('nazva',''))[:60]}"
                )
        else:
            cards_cache[nreg] = {
                "_fetched_at": datetime.utcnow().isoformat(),
                "_source":     src,
                "_not_found":  True,
            }
            errors += 1

        time.sleep(SLEEP_SEC)

        if (i + 1) % SAVE_EVERY == 0:
            _save_cards_cache(cards_cache)

        if (i + 1) % LOG_EVERY == 0:
            done_real = fetched + errors
            pct = round((i + 1) / total * 100)
            eta = _eta(t0, done_real, need_fetch) if need_fetch else "—"
            elapsed = int(time.time() - t0)
            speed = round(fetched / elapsed, 1) if elapsed > 0 else 0
            _log(
                f"[Phase 1] {i+1}/{total} ({pct}%) | "
                f"отримано={fetched} | помилок={errors} | кеш={skipped} | "
                f"швидкість={speed}/с | ETA: {eta}"
            )

    _save_cards_cache(cards_cache)
    elapsed = int(time.time() - t0)
    _log(
        f"[Phase 1] ✓ Завершено за {elapsed}с | "
        f"fetched={fetched} | errors={errors} | з_кешу={skipped} | всього={total}"
    )
    return {"fetched": fetched, "errors": errors, "skipped": skipped, "total": total}


# ── Phase 2: Reverse dead index ────────────────────────────────────────────────

def run_phase2(cards_cache: dict) -> dict:
    """
    Будує:
      dokid_to_nreg:  {dokid_str: nreg}
      reverse_dead:   {target_dokid: [{cancelled_by, rel_name, rel_code}]}
    """
    dokid_to_nreg: dict[str, str] = {}
    reverse_dead:  dict[str, list] = {}

    valid_cards = {n: c for n, c in cards_cache.items() if not c.get("_not_found")}
    not_found   = len(cards_cache) - len(valid_cards)

    _log(f"[Phase 2] Карток у кеші: {len(cards_cache)} | валідних: {len(valid_cards)} | not_found: {not_found}")

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
    _log(
        f"[Phase 2] ✓ Скасувань (dead link types): {cancels_total} | "
        f"унікальних цілей: {unique_targets}"
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

    _log(f"[Phase 3] Документів для обробки: {total}")

    LOG_EVERY = 200

    for i, (src, nreg) in enumerate(all_nregs):
        if _stop_event and _stop_event.is_set():
            _log(f"[Phase 3] Зупинено на {i}/{total}", "warning")
            break

        card = cards_cache.get(nreg)
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

            enriched = _build_enriched(nreg, card, reverse_dead, dokid_to_nreg)
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

        if (i + 1) % LOG_EVERY == 0:
            pct = round((i + 1) / total * 100)
            eta = _eta(t0, updated, total - skipped) if updated else "?"
            _log(
                f"[Phase 3] {i+1}/{total} ({pct}%) | "
                f"записано={updated} | пропущено={skipped} | помилок={errors} | "
                f"мертвих={dead_total} (статус={dead_by_status}, link={dead_by_link}) | "
                f"без_тексту={no_text} | ETA: {eta}"
            )

    elapsed = int(time.time() - t0)
    pct_dead = round(dead_total / updated * 100) if updated else 0
    _log(
        f"[Phase 3] ✓ Завершено за {elapsed}с | "
        f"записано={updated} | пропущено={skipped} | помилок={errors}"
    )
    _log(
        f"[Phase 3] Мертвих: {dead_total} ({pct_dead}%) | "
        f"за статусом={dead_by_status} | reverse link={dead_by_link} | без тексту={no_text}"
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
