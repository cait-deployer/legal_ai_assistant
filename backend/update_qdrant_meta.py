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
from datetime import datetime
from pathlib import Path

from qdrant_client.models import FieldCondition, Filter, MatchValue

from qdrant_storage import (
    RADA_COLLECTIONS, RADA_V2_COLLECTIONS,
    get_client,
)

RAW_BASE   = Path("/root/laws_raw")
STATE_FILE = Path(__file__).parent / "update_qdrant_meta_state.json"

# Колекції Rada (v1 + v2)
_RADA_ALL = RADA_COLLECTIONS + RADA_V2_COLLECTIONS
# Колекції KMU (v1 + v2)
_KMU_ALL  = ["laws_kmu", "laws_kmu_v2"]

SOURCES_COLLECTIONS: dict[str, list[str]] = {
    "rada": _RADA_ALL,
    "kmu":  _KMU_ALL,
}

# Поля які переносимо з .meta.json у Qdrant payload
ENRICH_FIELDS = [
    "rada_status",
    "rada_status_name",
    "rada_is_dead",
    "rada_is_dead_by_status",
    "rada_is_dead_by_link",
    "rada_no_text",
    "rada_tags",
    "rada_dokid",
    "rada_nreg",
    "rada_minjust",
    "rada_n_vlas",
    "rada_doc_type",
    "rada_doc_types",
    "rada_org",
    "rada_org_id",
    "rada_adopted_date",
    "rada_last_edition",
    "rada_replaced_by",
    "rada_cancelled_by",
    "rada_dead_since",
    "rada_theme",
    "rada_classifiers",
    "rada_editions_cnt",
    "rada_title",
    "rada_url",
    "rada_enriched_at",
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
    """Повертає імена колекцій що реально існують в Qdrant."""
    try:
        resp = get_client().get_collections()
        return {c.name for c in resp.collections}
    except Exception as e:
        _log(f"[qdrant patch] Помилка отримання колекцій: {e}", "error")
        return set()


def run_update_qdrant(
    log_callback=print,
    stop_event: threading.Event | None = None,
    sources: list[str] | None = None,
) -> None:
    """Entry point для server.py. Запускається в окремому потоці."""
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

    client      = get_client()
    existing    = _existing_collections()
    updated_pts = errors = skipped = total_files = 0

    try:
        for src in sources:
            src_dir = RAW_BASE / src
            if not src_dir.exists():
                _log(f"[qdrant patch] Директорія не знайдена: {src_dir}", "warning")
                continue

            # Колекції цього джерела що реально існують
            target_colls = [c for c in SOURCES_COLLECTIONS.get(src, []) if c in existing]
            if not target_colls:
                _log(f"[qdrant patch] {src}: немає колекцій у Qdrant, пропускаємо")
                continue

            meta_files = sorted(src_dir.glob("*.meta.json"))
            src_total  = len(meta_files)
            total_files += src_total
            _log(f"[qdrant patch] {src}: {src_total} файлів -> {target_colls}")

            for i, meta_path in enumerate(meta_files):
                if _stop_event and _stop_event.is_set():
                    _log(f"[qdrant patch] Зупинено на {i}/{src_total}", "warning")
                    state.update({"running": False, "phase": "stopped"})
                    _save_state(state)
                    return

                # nreg = filename без ".meta.json"
                nreg = meta_path.name[: -len(".meta.json")]

                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception as e:
                    _log(f"[qdrant patch] Не вдалося прочитати {meta_path.name}: {e}", "error")
                    errors += 1
                    continue

                if "rada_is_dead" not in meta:
                    skipped += 1
                    continue

                payload = {k: meta[k] for k in ENRICH_FIELDS if k in meta and meta[k] is not None}

                law_filter = Filter(
                    must=[FieldCondition(key="law_id", match=MatchValue(value=nreg))]
                )

                for coll in target_colls:
                    try:
                        client.set_payload(
                            collection_name=coll,
                            payload=payload,
                            points=law_filter,
                        )
                        updated_pts += 1
                    except Exception as e:
                        _log(f"[qdrant patch] ПОМИЛКА {coll}/{nreg}: {e}", "error")
                        errors += 1

                if (i + 1) % 500 == 0:
                    pct = round((i + 1) / src_total * 100)
                    _log(
                        f"[qdrant patch] {src} {i+1}/{src_total} ({pct}%)"
                        f" | payload_updates={updated_pts} | errors={errors}"
                    )

        state.update({
            "running":      False,
            "completed_at": datetime.utcnow().isoformat(),
            "stats": {
                "total_files":   total_files,
                "updated_pts":   updated_pts,
                "skipped":       skipped,
                "errors":        errors,
            },
        })
        _save_state(state)
        _log(
            f"[qdrant patch] Завершено: файлів={total_files}"
            f" | payload_updates={updated_pts} | пропущено={skipped} | помилок={errors}"
        )

    except Exception as e:
        _log(f"[qdrant patch] КРИТИЧНА ПОМИЛКА: {e}", "error")
        state.update({"running": False, "error": str(e)})
        _save_state(state)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Патч Qdrant payload з meta.json")
    parser.add_argument("--source", choices=["rada", "kmu", "all"], default="all")
    args = parser.parse_args()
    srcs = ["rada", "kmu"] if args.source == "all" else [args.source]
    run_update_qdrant(sources=srcs)
