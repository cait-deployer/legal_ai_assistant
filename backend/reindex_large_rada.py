"""
reindex_large_rada.py — re-indexes rada documents larger than MIN_SIZE bytes.

These were truncated to 8000 chars in the original reindex (TRUNCATE["rada"]=8000),
so most of their content was missing from Qdrant. Now TRUNCATE["rada"]=2_000_000,
so re-indexing them will include the full text.

Run from /home/devops/app/backend:
    python reindex_large_rada.py                               # re-index all > 50KB
    python reindex_large_rada.py --min-kb 100                  # re-index all > 100KB
    python reindex_large_rada.py --dry-run                     # show what would be re-indexed
    python reindex_large_rada.py --resume                      # skip already-done (reads state file)
    python reindex_large_rada.py --law-ids 80731-10 80732-10   # re-index specific IDs (any size)
"""
import argparse
import json
import sys
import time
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

RAW_DIR   = Path("/root/laws_raw/rada")
STATE_FILE = Path(__file__).parent / "reindex_large_state.json"

DEFAULT_MIN_KB = 50
WORKERS = 2  # keep low — embed_v2 is sequential anyway, Qdrant has 4-worker limit


_print_lock = threading.Lock()

def _log(msg: str):
    with _print_lock:
        print(msg, flush=True)


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text("utf-8"))
        except Exception:
            pass
    return {"done": [], "failed": []}


def _save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


def _get_large_files(min_bytes: int) -> list[tuple[str, Path]]:
    """Returns [(law_id, meta_path)] for rada files larger than min_bytes."""
    result = []
    for txt_path in sorted(RAW_DIR.glob("*.txt")):
        if txt_path.stat().st_size < min_bytes:
            continue
        meta_path = txt_path.with_suffix("").with_suffix(".meta.json")
        if not meta_path.exists():
            continue
        law_id = txt_path.stem
        result.append((law_id, meta_path))
    return result


def _get_specific_files(law_ids: list[str]) -> list[tuple[str, Path]]:
    """Returns [(law_id, meta_path)] for explicitly specified law_ids."""
    result = []
    for law_id in law_ids:
        txt_path = RAW_DIR / f"{law_id}.txt"
        meta_path = RAW_DIR / f"{law_id}.meta.json"
        if not txt_path.exists():
            print(f"  ⚠️  Файл не знайдено: {txt_path}", flush=True)
            continue
        if not meta_path.exists():
            print(f"  ⚠️  Мета не знайдено: {meta_path}", flush=True)
            continue
        result.append((law_id, meta_path))
    return result


def _process_one(law_id: str, meta_path: Path) -> tuple[str, bool, str]:
    """Returns (law_id, success, info)."""
    try:
        from reindex_v2 import _process_law
        stats = _process_law("rada", law_id, str(meta_path))
        ok  = stats["uploaded"] > 0
        msg = f"chunks={stats['chunks']} uploaded={stats['uploaded']} errors={stats['errors']}"
        return law_id, ok, msg
    except Exception as ex:
        return law_id, False, str(ex)


def run(min_kb: int = DEFAULT_MIN_KB, dry_run: bool = False, resume: bool = False,
        law_ids: list[str] | None = None):
    if law_ids:
        files = _get_specific_files(law_ids)
        _log(f"\n{'='*60}")
        _log(f"  Конкретні ID ({len(files)}): {law_ids}")
        _log(f"{'='*60}\n")
    else:
        min_bytes = min_kb * 1024
        files = _get_large_files(min_bytes)
        _log(f"\n{'='*60}")
        _log(f"  Файлів > {min_kb} KB: {len(files)}")
        _log(f"{'='*60}\n")

    if dry_run:
        for law_id, meta_path in files[:50]:
            size_kb = (RAW_DIR / f"{law_id}.txt").stat().st_size // 1024
            _log(f"  {law_id:20s}  {size_kb:>6} KB")
        if len(files) > 50:
            _log(f"  ... та ще {len(files)-50} файлів")
        return

    state = _load_state() if resume else {"done": [], "failed": []}
    done_set = set(state["done"])

    todo = [(lid, mp) for lid, mp in files if lid not in done_set]
    _log(f"  До обробки: {len(todo)}  (вже зроблено: {len(done_set)})\n")

    processed = 0
    failed    = 0
    t0 = time.time()

    for law_id, meta_path in todo:
        size_kb = (RAW_DIR / f"{law_id}.txt").stat().st_size // 1024
        _log(f"  [{processed+1}/{len(todo)}] {law_id} ({size_kb} KB)...")

        _, ok, msg = _process_one(law_id, meta_path)

        if ok:
            processed += 1
            state["done"].append(law_id)
            _log(f"  ✅ {msg}")
        else:
            failed += 1
            state["failed"].append(law_id)
            _log(f"  ❌ {msg}")

        _save_state(state)

        elapsed = time.time() - t0
        avg = elapsed / (processed + failed)
        remaining = avg * (len(todo) - processed - failed)
        _log(f"     Прогрес: {processed+failed}/{len(todo)}  "
             f"| Elapsed: {elapsed/60:.1f}m  | ETA: {remaining/60:.1f}m\n")

    _log(f"\n{'='*60}")
    _log(f"  Готово! Оброблено: {processed}  Помилок: {failed}")

    if processed > 0 and failed == 0:
        STATE_FILE.unlink(missing_ok=True)
        _log("  State файл видалено (все успішно)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-kb",   type=int, default=DEFAULT_MIN_KB,
                        help=f"min file size in KB (default: {DEFAULT_MIN_KB})")
    parser.add_argument("--dry-run",  action="store_true", help="show files without processing")
    parser.add_argument("--resume",   action="store_true", help="skip already-done files")
    parser.add_argument("--law-ids",  nargs="+", metavar="ID",
                        help="reindex specific law_ids regardless of size (e.g. 80731-10 80732-10)")
    args = parser.parse_args()
    run(min_kb=args.min_kb, dry_run=args.dry_run, resume=args.resume, law_ids=args.law_ids)
