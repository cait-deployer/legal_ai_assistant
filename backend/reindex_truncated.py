"""
reindex_truncated.py — re-indexes documents that were previously truncated.

The old TRUNCATE settings (rada=8000, kmu=15000) caused most content of large laws
to be missing from Qdrant. This script finds those files and re-indexes them fully.

Thresholds (= old TRUNCATE values):
    rada: 8 000 chars  → files > 8 KB were truncated
    kmu:  15 000 chars → files > 15 KB were truncated

Entry point for admin API:
    run_fix_truncated(source, log_callback, stop_event)

Run standalone:
    python reindex_truncated.py --source rada
    python reindex_truncated.py --source kmu
    python reindex_truncated.py --source rada --resume
    python reindex_truncated.py --source rada --dry-run
"""
import json
import sys
import time
import threading
from pathlib import Path

RAW_BASE = Path("/root/laws_raw")

# Old truncation thresholds — files larger than this were partially indexed
OLD_TRUNCATE = {
    "rada": 8_000,
    "kmu":  15_000,
}

SUPPORTED_SOURCES = list(OLD_TRUNCATE.keys())

_print_lock = threading.Lock()


def _make_state_path(source: str) -> Path:
    return Path(__file__).parent / f"reindex_truncated_{source}_state.json"


def _load_state(source: str) -> dict:
    p = _make_state_path(source)
    if p.exists():
        try:
            return json.loads(p.read_text("utf-8"))
        except Exception:
            pass
    return {"done": [], "failed": [], "total": 0, "processed": 0}


def _save_state(source: str, state: dict):
    _make_state_path(source).write_text(
        json.dumps(state, ensure_ascii=False, indent=2), "utf-8"
    )


def _clear_state(source: str):
    p = _make_state_path(source)
    p.unlink(missing_ok=True)


def _get_truncated_files(source: str) -> list[tuple[str, Path]]:
    """Returns [(law_id, meta_path)] for files larger than old truncation threshold."""
    src_dir = RAW_BASE / source
    if not src_dir.exists():
        return []

    threshold = OLD_TRUNCATE[source]
    result = []
    for txt_path in sorted(src_dir.glob("*.txt")):
        try:
            if txt_path.stat().st_size <= threshold:
                continue
        except OSError:
            continue
        meta_path = txt_path.with_suffix("").with_suffix(".meta.json")
        if not meta_path.exists():
            continue
        law_id = txt_path.stem
        result.append((law_id, meta_path))
    return result


def run_fix_truncated(
    source: str,
    log_callback=None,
    stop_event: threading.Event | None = None,
    resume: bool = True,
):
    """
    Main entry point. Re-indexes all files in `source` that exceed the old
    truncation threshold. Safe: embed first → delete old → upload new.
    """
    log = log_callback or (lambda m, lv="info": print(f"[{lv}] {m}", flush=True))

    if source not in SUPPORTED_SOURCES:
        log(f"Непідтримуване джерело: {source}. Доступні: {SUPPORTED_SOURCES}", "error")
        return

    files = _get_truncated_files(source)
    threshold_kb = OLD_TRUNCATE[source] // 1024

    log(f"Джерело: {source} | Файлів > {threshold_kb} KB: {len(files)}", "info")

    state = _load_state(source) if resume else {"done": [], "failed": [], "total": len(files), "processed": 0}
    state["total"] = len(files)
    done_set = set(state["done"])

    todo = [(lid, mp) for lid, mp in files if lid not in done_set]
    log(f"До обробки: {len(todo)}  (вже зроблено: {len(done_set)})", "info")

    if not todo:
        log("Нічого обробляти — все вже проіндексовано.", "info")
        return

    from reindex_v2 import _process_law

    processed = 0
    failed    = 0
    t0 = time.time()

    for law_id, meta_path in todo:
        if stop_event and stop_event.is_set():
            log("⏸ Зупинено. Прогрес збережено.", "warning")
            _save_state(source, state)
            return

        size_kb = (RAW_BASE / source / f"{law_id}.txt").stat().st_size // 1024
        idx = len(done_set) + processed + failed + 1
        log(f"[{idx}/{len(files)}] {law_id} ({size_kb} KB)...", "info")

        try:
            stats = _process_law(source, law_id, str(meta_path))
            ok  = stats["uploaded"] > 0
            msg = f"chunks={stats['chunks']} uploaded={stats['uploaded']} errors={stats['errors']}"
        except Exception as ex:
            ok  = False
            msg = str(ex)

        if ok:
            processed += 1
            state["done"].append(law_id)
            log(f"  ✅ {msg}", "info")
        else:
            failed += 1
            state["failed"].append(law_id)
            log(f"  ❌ {msg}", "error")

        state["processed"] = len(state["done"])
        _save_state(source, state)

        elapsed   = time.time() - t0
        remaining_count = len(todo) - processed - failed
        if processed + failed > 0:
            avg       = elapsed / (processed + failed)
            remaining = avg * remaining_count
            log(f"     ⏱ {elapsed/60:.1f}m elapsed | ETA ~{remaining/60:.1f}m | залишилось {remaining_count}", "info")

    log(f"✅ Готово! Оброблено: {processed}  Помилок: {failed}", "info")

    if failed == 0:
        _clear_state(source)


def get_resume_progress(source: str) -> dict | None:
    state = _load_state(source)
    if not state.get("total"):
        return None
    return {
        "done":      len(state.get("done", [])),
        "failed":    len(state.get("failed", [])),
        "total":     state.get("total", 0),
        "processed": state.get("processed", 0),
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--source",  required=True, choices=SUPPORTED_SOURCES)
    parser.add_argument("--resume",  action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        files = _get_truncated_files(args.source)
        threshold_kb = OLD_TRUNCATE[args.source] // 1024
        print(f"Файлів > {threshold_kb} KB у {args.source}: {len(files)}")
        for law_id, _ in files[:30]:
            size = (RAW_BASE / args.source / f"{law_id}.txt").stat().st_size
            print(f"  {law_id:25s}  {size//1024:>6} KB")
        if len(files) > 30:
            print(f"  ... та ще {len(files)-30}")
    else:
        run_fix_truncated(args.source, resume=args.resume)
