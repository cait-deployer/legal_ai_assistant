"""
URAI — Патч Qdrant payload з збагачених .meta.json (без переіндексації).

Архітектура v2 (швидка):
  1. Завантажуємо всі збагачені payload-и в пам'ять (law_id → dict)
  2. Для кожної колекції ПАРАЛЕЛЬНО:
     а. scroll() — один прохід по всіх точках → будуємо law_id → [point_ids]
     б. set_payload(points=[ids], payload=...) — оновлення по ID (швидко, без скану)
  Замість 75k × 26 = 2M filter-сканів: 26 scroll-проходів + ~1M ID-оновлень.

Запуск вручну:
  python update_qdrant_meta.py [--source rada|kmu|all]
"""

import argparse
import json
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from qdrant_client.models import FieldCondition, Filter, MatchValue

from qdrant_storage import (
    RADA_COLLECTIONS, RADA_V2_COLLECTIONS,
    get_client,
)

RAW_BASE   = Path("/root/laws_raw")
STATE_FILE = Path(__file__).parent / "update_qdrant_meta_state.json"

COLL_WORKERS     = 8   # паралельних колекцій одночасно
SCROLL_BATCH     = 500 # точок за один scroll()
LOG_INTERVAL_SEC = 30

_RADA_ALL = RADA_COLLECTIONS + RADA_V2_COLLECTIONS
_KMU_ALL  = ["laws_kmu", "laws_kmu_v2"]

SOURCES_COLLECTIONS: dict[str, list[str]] = {
    "rada": _RADA_ALL,
    "kmu":  _KMU_ALL,
}

ENRICH_FIELDS = [
    "rada_status", "rada_status_name",
    "rada_is_dead", "rada_is_dead_by_status", "rada_is_dead_by_link",
    "rada_no_text", "rada_tags", "rada_dokid", "rada_nreg", "rada_minjust",
    "rada_n_vlas", "rada_doc_type", "rada_doc_types", "rada_org", "rada_org_id",
    "rada_adopted_date", "rada_last_edition", "rada_replaced_by",
    "rada_cancelled_by", "rada_dead_since", "rada_theme", "rada_classifiers",
    "rada_editions_cnt", "rada_title", "rada_url", "rada_enriched_at",
]

_stop_event: threading.Event | None = None
_log_fn = print
_lock   = threading.Lock()


def _log(msg: str, level: str = "info") -> None:
    with _lock:
        _log_fn(msg, level) if _log_fn != print else print(msg)


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


def _existing_collections() -> set[str]:
    try:
        resp = get_client().get_collections()
        return {c.name for c in resp.collections}
    except Exception as e:
        _log(f"[qdrant patch] Помилка отримання колекцій: {e}", "error")
        return set()


def _load_enriched_payloads(sources: list[str]) -> dict[str, dict]:
    """Завантажує всі збагачені .meta.json в пам'ять: law_id → payload dict."""
    enriched: dict[str, dict] = {}
    for src in sources:
        src_dir = RAW_BASE / src
        if not src_dir.exists():
            continue
        for mf in src_dir.glob("*.meta.json"):
            try:
                meta = json.loads(mf.read_text(encoding="utf-8"))
            except Exception:
                continue
            if "rada_is_dead" not in meta:
                continue  # не збагачений — пропускаємо
            law_id = mf.name[: -len(".meta.json")]
            enriched[law_id] = {
                k: meta[k]
                for k in ENRICH_FIELDS
                if k in meta and meta[k] is not None
            }
    return enriched


def _patch_collection(
    coll: str,
    enriched: dict[str, dict],
    stop_event: threading.Event | None,
) -> dict:
    """
    Один прохід по колекції:
      1. scroll() → будує law_id → [point_ids]
      2. set_payload(points=[ids]) для кожного закону
    Повертає статистику.
    """
    client = get_client()
    start  = time.monotonic()

    # ── Фаза 1: scroll ────────────────────────────────────────────────────────
    law_to_ids: dict[str, list] = defaultdict(list)
    total_points = 0
    offset = None

    while True:
        if stop_event and stop_event.is_set():
            return {"coll": coll, "stopped": True}
        try:
            results, offset = client.scroll(
                collection_name=coll,
                limit=SCROLL_BATCH,
                offset=offset,
                with_payload=["law_id"],
                with_vectors=False,
            )
        except Exception as e:
            _log(f"[qdrant patch] ❌ scroll {coll}: {e}", "error")
            return {"coll": coll, "error": str(e)}

        for point in results:
            lid = (point.payload or {}).get("law_id", "")
            if lid and lid in enriched:
                law_to_ids[lid].append(point.id)
            total_points += 1

        if offset is None:
            break

    scroll_time = time.monotonic() - start
    n_to_patch  = len(law_to_ids)
    _log(
        f"[qdrant patch] 🔍 {coll}: {total_points:,} точок прогорнуто за"
        f" {scroll_time:.1f}с | {n_to_patch} законів для патчу"
    )

    if not law_to_ids:
        return {"coll": coll, "updated": 0, "errors": 0, "skipped": 0, "points": total_points}

    # ── Фаза 2: set_payload по point IDs ─────────────────────────────────────
    updated = errors = 0
    for law_id, ids in law_to_ids.items():
        if stop_event and stop_event.is_set():
            return {"coll": coll, "stopped": True}
        try:
            client.set_payload(
                collection_name=coll,
                payload=enriched[law_id],
                points=ids,
            )
            updated += 1
        except Exception as e:
            _log(f"[qdrant patch] ❌ set_payload {coll}/{law_id}: {e}", "error")
            errors += 1

    elapsed = time.monotonic() - start
    _log(
        f"[qdrant patch] ✅ {coll}: {updated} законів оновлено"
        f" | errors={errors} | {elapsed:.1f}с всього"
    )
    return {
        "coll": coll, "updated": updated, "errors": errors,
        "skipped": n_to_patch - updated - errors, "points": total_points,
    }


def run_update_qdrant(
    log_callback=print,
    stop_event: threading.Event | None = None,
    sources: list[str] | None = None,
) -> None:
    global _stop_event, _log_fn
    _stop_event = stop_event
    _log_fn     = log_callback

    if sources is None:
        sources = ["rada", "kmu"]

    state: dict = _load_state()
    state.update({
        "running":    True,
        "started_at": datetime.utcnow().isoformat(),
        "sources":    sources,
        "error":      None,
    })
    _save_state(state)

    # ── Крок 1: завантажити всі збагачені payload-и в RAM ────────────────────
    _log("[qdrant patch] 📂 Завантажую збагачені .meta.json в пам'ять...")
    t0 = time.monotonic()
    enriched = _load_enriched_payloads(sources)
    _log(
        f"[qdrant patch] ✔ Завантажено {len(enriched):,} збагачених законів"
        f" за {time.monotonic() - t0:.1f}с"
    )

    if not enriched:
        _log("[qdrant patch] ⚠️  Немає збагачених законів — запусти спочатку Фазу 1–3", "warning")
        state.update({"running": False})
        _save_state(state)
        return

    # ── Крок 2: визначити колекції ────────────────────────────────────────────
    existing = _existing_collections()
    all_colls: list[str] = []
    for src in sources:
        colls = [c for c in SOURCES_COLLECTIONS.get(src, []) if c in existing]
        all_colls.extend(colls)

    if not all_colls:
        _log("[qdrant patch] ⚠️  Немає колекцій у Qdrant", "warning")
        state.update({"running": False})
        _save_state(state)
        return

    _log(
        f"[qdrant patch] 🚀 Старт: {len(all_colls)} колекцій"
        f" | {COLL_WORKERS} паралельних воркерів"
        f" | scroll_batch={SCROLL_BATCH}"
    )
    _log(f"[qdrant patch]   колекції: {', '.join(all_colls)}")
    _log(
        f"[qdrant patch]   нова архітектура: scroll_once_per_coll + set_payload_by_ids"
        f" (замість {len(enriched):,} × {len(all_colls)} filter-сканів)"
    )

    # ── Крок 3: паралельна обробка колекцій ──────────────────────────────────
    run_start      = time.monotonic()
    total_updated  = total_errors = total_points = 0
    done_colls     = 0
    last_log_at    = [run_start]

    def _progress_log(label: str = "") -> None:
        elapsed = time.monotonic() - run_start
        pct     = round(done_colls / len(all_colls) * 100, 1) if all_colls else 0
        _log(
            f"[qdrant patch] {label}{done_colls}/{len(all_colls)} колекцій ({pct}%)"
            f" | updated={total_updated:,} pts | errors={total_errors}"
            f" | elapsed={int(elapsed // 60)}хв {int(elapsed % 60)}с"
        )

    hb_stop = threading.Event()
    def _heartbeat():
        while not hb_stop.wait(timeout=LOG_INTERVAL_SEC):
            now = time.monotonic()
            if now - last_log_at[0] >= LOG_INTERVAL_SEC - 1:
                last_log_at[0] = now
                _progress_log("⏳ ")
    hb = threading.Thread(target=_heartbeat, daemon=True)
    hb.start()

    try:
        with ThreadPoolExecutor(max_workers=COLL_WORKERS) as pool:
            futures = {
                pool.submit(_patch_collection, coll, enriched, stop_event): coll
                for coll in all_colls
            }
            for fut in as_completed(futures):
                if stop_event and stop_event.is_set():
                    pool.shutdown(wait=False, cancel_futures=True)
                    _log("[qdrant patch] ⏹ Зупинено", "warning")
                    state.update({"running": False, "phase": "stopped"})
                    _save_state(state)
                    return

                res = fut.result()
                if res.get("stopped"):
                    continue
                if res.get("error"):
                    _log(f"[qdrant patch] ❌ Колекція {res['coll']} завершилась з помилкою: {res['error']}", "error")

                with _lock:
                    done_colls    += 1
                    total_updated += res.get("updated", 0)
                    total_errors  += res.get("errors", 0)
                    total_points  += res.get("points", 0)

                now = time.monotonic()
                if now - last_log_at[0] >= LOG_INTERVAL_SEC:
                    last_log_at[0] = now
                    _progress_log()

    finally:
        hb_stop.set()
        hb.join(timeout=2)

    elapsed_total = time.monotonic() - run_start
    state.update({
        "running":      False,
        "completed_at": datetime.utcnow().isoformat(),
        "stats": {
            "collections":   len(all_colls),
            "total_points":  total_points,
            "updated_laws":  total_updated,
            "errors":        total_errors,
        },
    })
    _save_state(state)
    _log(
        f"[qdrant patch] 🏁 Завершено за {int(elapsed_total // 60)}хв {int(elapsed_total % 60)}с"
        f" | колекцій={len(all_colls)}"
        f" | оновлено законів={total_updated:,}"
        f" | помилок={total_errors}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Патч Qdrant payload з meta.json")
    parser.add_argument("--source", choices=["rada", "kmu", "all"], default="all")
    args = parser.parse_args()
    srcs = ["rada", "kmu"] if args.source == "all" else [args.source]
    run_update_qdrant(sources=srcs)
