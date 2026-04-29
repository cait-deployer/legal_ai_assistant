"""
URAI — Патч Qdrant payload з збагачених .meta.json (без переіндексації).

Читає rada_* поля з .meta.json → set_payload() на всі chunks документа.
Торкає тільки metadata, вектори не змінюються.

Запуск вручну:
  python update_qdrant_meta.py [--source rada|kmu|all]

Запуск з сервера:
  run_update_qdrant(log_callback, stop_event, sources)
"""

import argparse
import json
import threading
import time
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

WORKERS = 8  # parallel law patchers
LOG_INTERVAL_SEC = 30  # гарантований лог кожні 30 секунд

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
_counter_lock = threading.Lock()


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


def _patch_one(meta_path: Path, target_colls: list[str]) -> tuple[int, int, bool, str]:
    """
    Patch all chunks of one law across all target collections.
    Returns (updates, errors, skipped, law_id).
    """
    if _stop_event and _stop_event.is_set():
        return 0, 0, True, ""

    nreg = meta_path.name[: -len(".meta.json")]

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        _log(f"[qdrant patch] ❌ Не вдалося прочитати {meta_path.name}: {e}", "error")
        return 0, 1, False, nreg

    if "rada_is_dead" not in meta:
        return 0, 0, False, nreg  # not enriched yet — skip silently

    payload = {k: meta[k] for k in ENRICH_FIELDS if k in meta and meta[k] is not None}
    law_filter = Filter(must=[FieldCondition(key="law_id", match=MatchValue(value=nreg))])

    client  = get_client()
    updates = errors = 0
    for coll in target_colls:
        try:
            client.set_payload(collection_name=coll, payload=payload, points=law_filter)
            updates += 1
        except Exception as e:
            _log(f"[qdrant patch] ❌ ПОМИЛКА {coll}/{nreg}: {e}", "error")
            errors += 1

    return updates, errors, False, nreg


def _fmt_eta(src_total: int, done: int, elapsed: float) -> str:
    if done == 0:
        return "ETA невідомо"
    speed = done / elapsed
    eta_sec = (src_total - done) / speed
    if eta_sec < 60:
        return f"ETA ~{int(eta_sec)}с"
    return f"ETA ~{int(eta_sec // 60)}хв {int(eta_sec % 60)}с"


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

    existing      = _existing_collections()
    total_updated = total_errors = total_skipped = total_files = 0

    try:
        for src in sources:
            src_dir = RAW_BASE / src
            if not src_dir.exists():
                _log(f"[qdrant patch] ⚠️  Директорія не знайдена: {src_dir}", "warning")
                continue

            target_colls = [c for c in SOURCES_COLLECTIONS.get(src, []) if c in existing]
            if not target_colls:
                _log(f"[qdrant patch] ⚠️  {src}: немає колекцій у Qdrant, пропускаємо", "warning")
                continue

            meta_files = sorted(src_dir.glob("*.meta.json"))
            src_total  = len(meta_files)
            total_files += src_total

            _log(
                f"[qdrant patch] ▶ {src.upper()}: {src_total} файлів"
                f" | колекцій={len(target_colls)} | workers={WORKERS}"
            )
            _log(f"[qdrant patch]   колекції: {', '.join(target_colls)}")
            _log(
                f"[qdrant patch]   на закон робиться {len(target_colls)} set_payload() викликів"
                f" | всього ~{src_total * len(target_colls):,} Qdrant операцій"
            )
            _log(f"[qdrant patch]   прогрес кожні {LOG_INTERVAL_SEC}с автоматично ━━━")

            # Shared counters (accessed by heartbeat thread + main loop)
            counters = {"done": 0, "updated": 0, "errors": 0, "skipped": 0, "last_law": ""}
            src_start    = time.monotonic()
            last_log_at  = [src_start]  # mutable for heartbeat closure

            def _do_log(label: str = "") -> None:
                with _counter_lock:
                    d  = counters["done"]
                    u  = counters["updated"]
                    e  = counters["errors"]
                    sk = counters["skipped"]
                    ll = counters["last_law"]
                elapsed  = time.monotonic() - src_start
                speed    = d / elapsed if elapsed > 0 else 0
                pct      = round(d / src_total * 100, 1) if src_total else 0
                err_rate = round(e / max(d, 1) * 100, 1)
                eta      = _fmt_eta(src_total, d, elapsed)
                elapsed_str = f"{int(elapsed // 60)}хв {int(elapsed % 60)}с"
                law_hint = f" | останній={ll}" if ll else ""
                _log(
                    f"[qdrant patch] {label}{src} {d}/{src_total} ({pct}%)"
                    f" | updates={u} skip={sk} err={e}({err_rate}%)"
                    f" | {speed:.1f} laws/s | {elapsed_str} | {eta}{law_hint}"
                )

            # Heartbeat thread — гарантує лог кожні LOG_INTERVAL_SEC с
            hb_stop = threading.Event()
            def _heartbeat():
                while not hb_stop.wait(timeout=LOG_INTERVAL_SEC):
                    now = time.monotonic()
                    if now - last_log_at[0] >= LOG_INTERVAL_SEC - 1:
                        last_log_at[0] = now
                        _do_log("⏳ ")
            hb_thread = threading.Thread(target=_heartbeat, daemon=True)
            hb_thread.start()

            try:
                with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                    futures = {
                        pool.submit(_patch_one, mf, target_colls): mf
                        for mf in meta_files
                    }
                    for fut in as_completed(futures):
                        if _stop_event and _stop_event.is_set():
                            pool.shutdown(wait=False, cancel_futures=True)
                            hb_stop.set()
                            with _counter_lock:
                                d = counters["done"]
                            _log(f"[qdrant patch] ⏹ {src}: зупинено на {d}/{src_total}", "warning")
                            state.update({"running": False, "phase": "stopped"})
                            _save_state(state)
                            return

                        upd, err, stopped, law_id = fut.result()
                        if stopped:
                            continue

                        with _counter_lock:
                            counters["done"]    += 1
                            counters["updated"] += upd
                            counters["errors"]  += err
                            if upd == 0 and err == 0:
                                counters["skipped"] += 1
                            if law_id:
                                counters["last_law"] = law_id

                        # Time-based log (fires from main thread when heartbeat missed)
                        now = time.monotonic()
                        if now - last_log_at[0] >= LOG_INTERVAL_SEC:
                            last_log_at[0] = now
                            _do_log()

            finally:
                hb_stop.set()
                hb_thread.join(timeout=2)

            # Final summary for this source
            with _counter_lock:
                updated = counters["updated"]
                errors  = counters["errors"]
                skipped = counters["skipped"]

            elapsed_total = time.monotonic() - src_start
            _log(
                f"[qdrant patch] ✅ {src.upper()} завершено за"
                f" {int(elapsed_total // 60)}хв {int(elapsed_total % 60)}с"
                f" | updates={updated} | skip={skipped} | errors={errors}"
            )
            total_updated += updated
            total_errors  += errors
            total_skipped += skipped

        state.update({
            "running":      False,
            "completed_at": datetime.utcnow().isoformat(),
            "stats": {
                "total_files":   total_files,
                "updated_pts":   total_updated,
                "skipped":       total_skipped,
                "errors":        total_errors,
            },
        })
        _save_state(state)
        _log(
            f"[qdrant patch] 🏁 Завершено: файлів={total_files}"
            f" | payload_updates={total_updated}"
            f" | пропущено={total_skipped} | помилок={total_errors}"
        )

    except Exception as e:
        _log(f"[qdrant patch] 💥 КРИТИЧНА ПОМИЛКА: {e}", "error")
        state.update({"running": False, "error": str(e)})
        _save_state(state)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Патч Qdrant payload з meta.json")
    parser.add_argument("--source", choices=["rada", "kmu", "all"], default="all")
    args = parser.parse_args()
    srcs = ["rada", "kmu"] if args.source == "all" else [args.source]
    run_update_qdrant(sources=srcs)
