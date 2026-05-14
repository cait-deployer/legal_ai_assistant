from __future__ import annotations

import threading
import json
from pathlib import Path
from typing import Callable

APPLIED_MANIFEST = Path(__file__).parent / "post_fix_applied_manifest.json"


def _load_applied() -> dict[str, set[str]]:
    if not APPLIED_MANIFEST.exists():
        return {}
    try:
        raw = json.loads(APPLIED_MANIFEST.read_text("utf-8"))
    except Exception:
        return {}
    return {
        source: {str(v) for v in values or []}
        for source, values in (raw.get("sources") or {}).items()
    }


def _record_applied(targets: dict[str, list[str]]) -> None:
    applied = _load_applied()
    for source, law_ids in targets.items():
        applied.setdefault(source, set()).update(law_ids)
    APPLIED_MANIFEST.write_text(
        json.dumps(
            {"sources": {source: sorted(values) for source, values in applied.items()}},
            ensure_ascii=False,
            indent=2,
        ),
        "utf-8",
    )


def _manifest_targets(sources: list[str] | None = None) -> dict[str, list[str]]:
    from reindex_truncated import _load_state, get_processed_manifest

    manifest = get_processed_manifest()
    wanted = set(sources or ["rada", "kmu"])
    targets: dict[str, list[str]] = {}
    for source, data in (manifest.get("sources") or {}).items():
        if source not in wanted:
            continue
        law_ids = [str(v).strip() for v in (data or {}).get("law_ids", []) if str(v).strip()]
        if law_ids:
            targets[source] = sorted(set(law_ids))
    for source in wanted:
        state = _load_state(source)
        state_done = [str(v).strip() for v in state.get("done", []) if str(v).strip()]
        if state_done:
            merged = set(targets.get(source, []))
            merged.update(state_done)
            targets[source] = sorted(merged)
    applied = _load_applied()
    for source, law_ids in list(targets.items()):
        remaining = sorted(set(law_ids) - applied.get(source, set()))
        if remaining:
            targets[source] = remaining
        else:
            targets.pop(source, None)
    return targets


def pending_status() -> dict:
    targets = _manifest_targets(["rada", "kmu"])
    return {
        "sources": {source: {"law_ids": law_ids, "count": len(law_ids)} for source, law_ids in targets.items()},
        "total": sum(len(v) for v in targets.values()),
    }


def run_post_fix_pipeline(
    *,
    sources: list[str] | None = None,
    log_callback: Callable[[str, str], None] | None = None,
    stop_event: threading.Event | None = None,
    rebuild_registry: Callable[[Callable[[str, str], None]], None] | None = None,
    clear_on_success: bool = True,
) -> dict:
    """Apply metadata/Qdrant/registry only to docs repaired by fix-truncated."""
    log = log_callback or (lambda msg, level="info": print(f"[{level}] {msg}", flush=True))
    wanted_sources = sources or ["rada", "kmu"]
    targets = _manifest_targets(wanted_sources)
    total = sum(len(v) for v in targets.values())
    if not total:
        log("[post-fix] No repaired large documents pending metadata pipeline", "warning")
        return {"ok": True, "targets": {}, "total": 0, "skipped": True}

    log(f"[post-fix] Targeted pipeline started | docs={total} | sources={', '.join(sorted(targets))}")
    for source, law_ids in targets.items():
        log(f"[post-fix] {source}: {len(law_ids)} docs")

    if stop_event and stop_event.is_set():
        return {"ok": False, "stopped": True, "targets": targets, "total": total}

    from enrich_opendata_meta import run_apply_text_cancellations, run_enrich_targets

    log("[post-fix] Step 1/4: targeted OpenData metadata refresh")
    enrich_result = run_enrich_targets(
        targets,
        log_callback=log,
        stop_event=stop_event,
        force=True,
    )

    if stop_event and stop_event.is_set():
        return {"ok": False, "stopped": True, "targets": targets, "total": total, "enrich": enrich_result}

    log("[post-fix] Step 2/4: targeted text cancellation cache apply")
    text_result = run_apply_text_cancellations(
        log_callback=log,
        stop_event=stop_event,
        sources=sorted(targets),
        target_nregs_by_source=targets,
    )

    if stop_event and stop_event.is_set():
        return {
            "ok": False,
            "stopped": True,
            "targets": targets,
            "total": total,
            "enrich": enrich_result,
            "text": text_result,
        }

    log("[post-fix] Step 3/4: targeted Qdrant payload patch")
    from update_qdrant_meta import run_update_qdrant

    run_update_qdrant(
        log_callback=log,
        stop_event=stop_event,
        sources=sorted(targets),
        law_ids_by_source=targets,
    )

    if stop_event and stop_event.is_set():
        return {
            "ok": False,
            "stopped": True,
            "targets": targets,
            "total": total,
            "enrich": enrich_result,
            "text": text_result,
        }

    log("[post-fix] Step 4/4: rebuild document registry")
    if rebuild_registry:
        rebuild_registry(log)

    if clear_on_success:
        from reindex_truncated import clear_processed_manifest

        _record_applied(targets)
        clear_processed_manifest(sorted(targets))
        log("[post-fix] Cleared processed manifest for completed sources")

    result = {
        "ok": True,
        "targets": targets,
        "total": total,
        "enrich": enrich_result,
        "text": text_result,
    }
    log("[post-fix] Targeted pipeline finished", "success")
    return result
