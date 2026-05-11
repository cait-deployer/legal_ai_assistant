"""
Re-index documents that were previously truncated in Qdrant.

Old limits:
    rada: first 8 000 chars
    kmu:  first 15 000 chars

This repair job reads the full text from /root/laws_raw/{source}, splits it into
proper chunks, embeds all chunks first, and only then replaces the old Qdrant
points. That order avoids data loss if embedding fails.
"""

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path


RAW_BASE = Path(os.environ.get("LAWS_RAW_DIR", "/root/laws_raw"))
HEARTBEAT_SEC = 20

OLD_TRUNCATE = {
    "rada": 8_000,
    "kmu": 15_000,
}

SUPPORTED_SOURCES = list(OLD_TRUNCATE.keys())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_state_path(source: str) -> Path:
    return Path(__file__).parent / f"reindex_truncated_{source}_state.json"


def _normalize_state(state: dict | None) -> dict:
    state = state or {}
    state.setdefault("done", [])
    state.setdefault("failed", [])
    state.setdefault("total", 0)
    state.setdefault("processed", len(state.get("done", [])))
    state.setdefault("current", None)
    return state


def _load_state(source: str) -> dict:
    p = _make_state_path(source)
    if p.exists():
        try:
            return _normalize_state(json.loads(p.read_text("utf-8")))
        except Exception:
            pass
    return _normalize_state({})


def _save_state(source: str, state: dict) -> None:
    _make_state_path(source).write_text(
        json.dumps(_normalize_state(state), ensure_ascii=False, indent=2),
        "utf-8",
    )


def _clear_state(source: str) -> None:
    _make_state_path(source).unlink(missing_ok=True)


def _get_truncated_files(source: str) -> list[tuple[str, Path]]:
    """Return [(law_id, meta_path)] for files larger than the old limit."""
    src_dir = RAW_BASE / source
    if not src_dir.exists():
        return []

    threshold = OLD_TRUNCATE[source]
    result: list[tuple[str, Path]] = []
    for txt_path in sorted(src_dir.glob("*.txt")):
        try:
            if txt_path.stat().st_size <= threshold:
                continue
        except OSError:
            continue
        meta_path = txt_path.with_suffix("").with_suffix(".meta.json")
        if meta_path.exists():
            result.append((txt_path.stem, meta_path))
    return result


def _chunk_offsets(text: str, chunks: list[str]) -> list[tuple[int, int]]:
    offsets: list[tuple[int, int]] = []
    cursor = 0
    for chunk in chunks:
        pos = text.find(chunk, cursor)
        if pos < 0:
            pos = text.find(chunk)
        if pos < 0:
            pos = cursor
        end = pos + len(chunk)
        offsets.append((pos, end))
        cursor = max(pos + 1, end - 300)
    return offsets


def _build_payload(
    source: str,
    meta: dict,
    chunk_text: str,
    chunk_idx: int,
    chunk_count: int,
    collection: str,
    full_text_chars: int,
    full_text_bytes: int,
    content_hash: str,
    offset: tuple[int, int],
) -> dict:
    from reindex_v2 import SOURCE_PREFIX

    title = meta.get("title", "")
    prefix = SOURCE_PREFIX.get(source, "")
    law_url = meta.get("law_url") or meta.get("rada_url") or meta.get("pdf_url") or meta.get("url") or ""
    return {
        "source": f"{prefix}{title}",
        "source_id": source,
        "law_id": meta["law_id"],
        "law_url": law_url,
        "law_domain": collection,
        "collection": collection,
        "title": title,
        "category": meta.get("category", ""),
        "rada_theme": meta.get("rada_theme", ""),
        "doc_type": meta.get("doc_type", ""),
        "status": meta.get("status", ""),
        "doc_number": meta.get("doc_number", ""),
        "author": meta.get("author", ""),
        "date_adopted": meta.get("date_adopted", ""),
        "effective_date": meta.get("effective_date", ""),
        "is_retroactive": meta.get("is_retroactive", False),
        "wartime_only": meta.get("wartime_only", False),
        "is_suspended": meta.get("is_suspended", False),
        "has_transitional": meta.get("has_transitional", False),
        "scraped_at": meta.get("scraped_at", ""),
        "indexed_at": _now(),
        "index_job": "fix_truncated_full_chunks",
        "chunk_index": chunk_idx,
        "chunk_count": chunk_count,
        "chunk_start": offset[0],
        "chunk_end": offset[1],
        "chunk_chars": len(chunk_text),
        "full_text_chars": full_text_chars,
        "full_text_bytes": full_text_bytes,
        "content_sha256": content_hash,
        "content": chunk_text,
    }


def _process_law_full(
    source: str,
    law_id: str,
    meta_path: str,
    log,
    stop_event: threading.Event | None,
) -> dict:
    import embed_v2
    from qdrant_storage import RADA_V2_COLLECTIONS, delete_law_chunks, upload_to_qdrant
    from reindex_v2 import SPLITTERS, _get_collection

    stats = {"chunks": 0, "uploaded": 0, "errors": 0}

    def fail_if_stopped(stage: str) -> None:
        if stop_event is not None and stop_event.is_set():
            raise InterruptedError(f"stopped during {stage}")

    meta = json.loads(Path(meta_path).read_text("utf-8"))
    meta["law_id"] = meta.get("law_id") or law_id
    txt_path = Path(meta_path).with_suffix("").with_suffix(".txt")
    full_text_bytes = txt_path.stat().st_size

    log(f"  [1/5] Read full text from disk: {full_text_bytes // 1024:,} KB", "info")
    raw_text = txt_path.read_text("utf-8")
    full_text_chars = len(raw_text)
    content_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
    fail_if_stopped("read")

    title_prefix = f"# {meta.get('title', '')}\n\n" if meta.get("title") else ""
    text_for_split = title_prefix + raw_text
    log(f"  [2/5] Split full document: {full_text_chars:,} chars, no truncation", "info")
    chunks = SPLITTERS[source].split_text(text_for_split)
    if not chunks:
        log(f"  Empty chunks: {law_id}", "warning")
        return stats

    offsets = _chunk_offsets(text_for_split, chunks)
    collection = _get_collection(source, meta)
    stats["chunks"] = len(chunks)
    avg_chunk = sum(len(c) for c in chunks) // max(len(chunks), 1)
    log(
        f"  Split ready: {len(chunks):,} chunks, avg {avg_chunk:,} chars, collection={collection}",
        "success",
    )
    fail_if_stopped("split")

    last_heartbeat = 0.0

    def embed_progress(done: int, total: int) -> None:
        nonlocal last_heartbeat
        now = time.time()
        if done == 1 or done == total or now - last_heartbeat >= HEARTBEAT_SEC:
            pct = (done / total) * 100 if total else 0
            log(f"  [3/5] Embedding: {done:,}/{total:,} chunks ({pct:.1f}%)", "info")
            last_heartbeat = now

    log("  [3/5] Embedding starts; old Qdrant chunks are still untouched.", "info")
    vectors = embed_v2.embed_documents(
        chunks,
        task="RETRIEVAL_DOCUMENT",
        progress_callback=embed_progress,
        stop_event=stop_event,
    )
    fail_if_stopped("embed")

    delete_targets = RADA_V2_COLLECTIONS if source == "rada" else [collection]
    log(f"  [4/5] Delete old partial chunks from {len(delete_targets)} collection(s)", "warning")
    for col in delete_targets:
        fail_if_stopped("delete")
        delete_law_chunks(law_id, col)

    log("  [5/5] Upload full chunks with rich metadata", "info")
    last_heartbeat = 0.0
    for i, (chunk_text, vector, offset) in enumerate(zip(chunks, vectors, offsets)):
        fail_if_stopped("upload")
        payload = _build_payload(
            source,
            meta,
            chunk_text,
            i,
            len(chunks),
            collection,
            full_text_chars,
            full_text_bytes,
            content_hash,
            offset,
        )
        ok = upload_to_qdrant(
            text=chunk_text,
            metadata={k: v for k, v in payload.items() if k != "content"},
            embedding=vector,
            collection_name=collection,
        )
        if ok:
            stats["uploaded"] += 1
        else:
            stats["errors"] += 1

        done = i + 1
        now = time.time()
        if done == 1 or done == len(chunks) or now - last_heartbeat >= HEARTBEAT_SEC:
            pct = (done / len(chunks)) * 100
            log(f"  Uploading: {done:,}/{len(chunks):,} chunks ({pct:.1f}%)", "info")
            last_heartbeat = now

    return stats


def run_fix_truncated(
    source: str,
    log_callback=None,
    stop_event: threading.Event | None = None,
    resume: bool = True,
):
    """Main entry point used by the admin API."""
    log = log_callback or (lambda m, lv="info": print(f"[{lv}] {m}", flush=True))

    if source not in SUPPORTED_SOURCES:
        log(f"Unsupported source: {source}. Available: {SUPPORTED_SOURCES}", "error")
        return

    files = _get_truncated_files(source)
    threshold_kb = OLD_TRUNCATE[source] // 1024
    log(f"Source: {source} | files above old {threshold_kb} KB limit: {len(files):,}", "info")

    state = _load_state(source) if resume else _normalize_state({"done": [], "failed": []})
    state["total"] = len(files)
    done_set = set(state.get("done", []))
    failed_set = set(state.get("failed", []))

    todo = [(lid, mp) for lid, mp in files if lid not in done_set]
    log(f"To process: {len(todo):,} (already done: {len(done_set):,})", "info")

    if not todo:
        log("Nothing to process: all detected large files are already re-indexed.", "success")
        return

    processed = 0
    failed = 0
    t0 = time.time()

    for law_id, meta_path in todo:
        if stop_event is not None and stop_event.is_set():
            log("Stopped. Progress was saved.", "warning")
            _save_state(source, state)
            return

        size_kb = (RAW_BASE / source / f"{law_id}.txt").stat().st_size // 1024
        idx = len(done_set) + processed + failed + 1
        log(f"[{idx:,}/{len(files):,}] {law_id} ({size_kb:,} KB)", "info")
        state["current"] = {"law_id": law_id, "size_kb": size_kb, "started_at": _now()}
        _save_state(source, state)

        try:
            stats = _process_law_full(source, law_id, str(meta_path), log, stop_event)
            ok = stats["uploaded"] > 0 and stats["errors"] == 0
            msg = f"chunks={stats['chunks']:,} uploaded={stats['uploaded']:,} errors={stats['errors']:,}"
        except InterruptedError as ex:
            state["current"] = None
            _save_state(source, state)
            log(f"Stopped safely: {ex}. Resume will continue from this document.", "warning")
            return
        except Exception as ex:
            ok = False
            msg = str(ex)

        if ok:
            processed += 1
            if law_id not in done_set:
                state["done"].append(law_id)
                done_set.add(law_id)
            log(f"  OK: {msg}", "success")
        else:
            failed += 1
            if law_id not in failed_set:
                state["failed"].append(law_id)
                failed_set.add(law_id)
            log(f"  ERROR: {msg}", "error")

        state["processed"] = len(state["done"])
        state["current"] = None
        _save_state(source, state)

        elapsed = time.time() - t0
        remaining_count = len(todo) - processed - failed
        if processed + failed > 0:
            avg = elapsed / (processed + failed)
            remaining = avg * remaining_count
            log(
                f"  ETA: elapsed {elapsed / 60:.1f}m | remaining ~{remaining / 60:.1f}m | left {remaining_count:,}",
                "info",
            )

    log(f"Done. Processed: {processed:,}; errors: {failed:,}", "success" if failed == 0 else "warning")

    if failed == 0:
        _clear_state(source)


def get_resume_progress(source: str) -> dict | None:
    state = _load_state(source)
    if not state.get("total"):
        return None
    return {
        "done": len(state.get("done", [])),
        "failed": len(state.get("failed", [])),
        "total": state.get("total", 0),
        "processed": state.get("processed", 0),
        "current": state.get("current"),
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, choices=SUPPORTED_SOURCES)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        files = _get_truncated_files(args.source)
        threshold_kb = OLD_TRUNCATE[args.source] // 1024
        print(f"Files above {threshold_kb} KB in {args.source}: {len(files):,}")
        for law_id, _ in files[:30]:
            size = (RAW_BASE / args.source / f"{law_id}.txt").stat().st_size
            print(f"  {law_id:25s}  {size // 1024:>6} KB")
        if len(files) > 30:
            print(f"  ... and {len(files) - 30:,} more")
    else:
        run_fix_truncated(args.source, resume=args.resume)
