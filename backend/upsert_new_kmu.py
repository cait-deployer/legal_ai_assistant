"""
upsert_new_kmu.py — Додає ТІЛЬКИ нові KMU документи до laws_kmu_v2.

Не чіпає існуючі 176k+ точок. Алгоритм:
  1. Зчитуємо всі law_id з laws_kmu_v2 (scroll)
  2. Знаходимо закони є на диску але відсутні в Qdrant
  3. Обробляємо тільки відсутні (embed → upsert), без delete

Запуск:
  cd /home/devops/app/backend
  /home/devops/app/venv/bin/python3 upsert_new_kmu.py
  /home/devops/app/venv/bin/python3 upsert_new_kmu.py --dry-run   # тільки показати що відсутнє
  /home/devops/app/venv/bin/python3 upsert_new_kmu.py --limit 500  # обробити перші 500 відсутніх
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).parent))

COLLECTION = "laws_kmu_v2"
RAW_DIR    = Path("/root/laws_raw/kmu")
WORKERS    = 3
SCROLL_BATCH = 500


def _get_existing_law_ids() -> set[str]:
    """Scroll through laws_kmu_v2 and collect all law_id values (raw + decoded variants)."""
    from qdrant_storage import get_client
    client = get_client()
    existing = set()
    offset = None
    total = 0

    print(f"[upsert] Scrolling {COLLECTION} to collect existing law_ids...", flush=True)
    while True:
        results, offset = client.scroll(
            collection_name=COLLECTION,
            limit=SCROLL_BATCH,
            offset=offset,
            with_payload=["law_id"],
            with_vectors=False,
        )
        for point in results:
            lid = (point.payload or {}).get("law_id", "")
            if lid:
                existing.add(lid)
                # also store decoded variant (kmu_ prefix + URL-decoded)
                decoded = unquote(lid)
                existing.add(decoded)
                # strip kmu_ prefix to match disk file naming
                if decoded.startswith("kmu_"):
                    existing.add(decoded[4:])
        total += len(results)
        if total % 50000 == 0 and total > 0:
            print(f"[upsert]   scrolled {total:,} points, {len(existing):,} unique ids...", flush=True)
        if offset is None:
            break

    print(f"[upsert] Done scrolling: {total:,} points, {len(existing):,} unique law_id variants", flush=True)
    return existing


def _discover_disk_ids() -> list[tuple[str, Path]]:
    """Return [(law_id, meta_path), ...] for all KMU docs on disk."""
    result = []
    if not RAW_DIR.exists():
        print(f"[upsert] ERROR: {RAW_DIR} not found", flush=True)
        return result
    for meta_path in sorted(RAW_DIR.glob("*.meta.json")):
        law_id = meta_path.name[: -len(".meta.json")]
        txt_path = meta_path.with_suffix("").with_suffix(".txt")
        if txt_path.exists():
            result.append((law_id, meta_path))
    return result


def _is_missing(law_id: str, existing: set[str]) -> bool:
    """Check whether this law_id (and its decoded/stripped forms) is absent from Qdrant."""
    if law_id in existing:
        return False
    decoded = unquote(law_id)
    if decoded in existing:
        return False
    # strip kmu_ prefix
    stripped = decoded[4:] if decoded.startswith("kmu_") else decoded
    if stripped in existing:
        return False
    # also check with kmu_ prefix added
    if f"kmu_{law_id}" in existing or f"kmu_{decoded}" in existing:
        return False
    return True


def _upsert_one(law_id: str, meta_path: Path) -> dict:
    """Embed and upload a single KMU law WITHOUT deleting existing chunks."""
    import embed_v2
    from qdrant_storage import upload_to_qdrant
    from langchain_text_splitters import MarkdownTextSplitter

    splitter = MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300)
    TRUNCATE = 15000
    PREFIX   = "КМУ: "

    stats = {"law_id": law_id, "chunks": 0, "uploaded": 0, "errors": 0}

    try:
        meta = json.loads(meta_path.read_text("utf-8"))
    except Exception as ex:
        stats["errors"] = 1
        stats["detail"] = f"meta read: {ex}"
        return stats

    txt_path = meta_path.with_suffix("").with_suffix(".txt")
    try:
        raw_text = txt_path.read_text("utf-8")
    except Exception as ex:
        stats["errors"] = 1
        stats["detail"] = f"txt read: {ex}"
        return stats

    title = meta.get("title", "")
    title_prefix = f"# {title}\n\n" if title else ""
    text_for_split = title_prefix + raw_text[:TRUNCATE]
    chunks = splitter.split_text(text_for_split)

    if not chunks:
        stats["detail"] = "empty chunks"
        return stats

    stats["chunks"] = len(chunks)

    try:
        vectors = embed_v2.embed_documents(chunks, task="RETRIEVAL_DOCUMENT")
    except Exception as ex:
        stats["errors"] = len(chunks)
        stats["detail"] = f"embed: {ex}"
        return stats

    law_url = meta.get("law_url") or meta.get("pdf_url") or meta.get("url") or ""

    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        payload = {
            "source":           f"{PREFIX}{title}",
            "law_id":           meta["law_id"],
            "law_url":          law_url,
            "law_domain":       COLLECTION,
            "category":         meta.get("category", ""),
            "doc_type":         meta.get("doc_type", ""),
            "status":           meta.get("status", ""),
            "doc_number":       meta.get("doc_number", ""),
            "author":           meta.get("author", ""),
            "date_adopted":     meta.get("date_adopted", ""),
            "effective_date":   meta.get("effective_date", ""),
            "is_retroactive":   meta.get("is_retroactive", False),
            "wartime_only":     meta.get("wartime_only", False),
            "is_suspended":     meta.get("is_suspended", False),
            "has_transitional": meta.get("has_transitional", False),
            "scraped_at":       meta.get("scraped_at", ""),
            "chunk_index":      i,
            "content":          chunk_text,
        }
        ok = upload_to_qdrant(
            text=chunk_text,
            metadata={k: v for k, v in payload.items() if k != "content"},
            embedding=vector,
            collection_name=COLLECTION,
        )
        if ok:
            stats["uploaded"] += 1
        else:
            stats["errors"] += 1

    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Only show missing, don't index")
    parser.add_argument("--limit", type=int, default=0, help="Process at most N missing docs (0 = all)")
    args = parser.parse_args()

    # Step 1: what's in Qdrant
    existing = _get_existing_law_ids()

    # Step 2: what's on disk
    disk_docs = _discover_disk_ids()
    print(f"[upsert] Disk: {len(disk_docs):,} KMU docs with both .txt and .meta.json", flush=True)

    # Step 3: find missing
    missing = [(lid, mp) for lid, mp in disk_docs if _is_missing(lid, existing)]
    print(f"[upsert] Missing from Qdrant: {len(missing):,} docs", flush=True)

    if not missing:
        print("[upsert] Nothing to do. All disk docs are already in Qdrant.", flush=True)
        return

    if args.dry_run:
        print("[upsert] DRY RUN — first 20 missing:", flush=True)
        for lid, _ in missing[:20]:
            print(f"  {lid}", flush=True)
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more", flush=True)
        return

    to_process = missing[: args.limit] if args.limit else missing
    print(f"[upsert] Will process {len(to_process):,} docs with {WORKERS} workers", flush=True)

    start = time.monotonic()
    done = uploaded_total = error_total = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(_upsert_one, lid, mp): lid for lid, mp in to_process}
        for fut in as_completed(futures):
            res = fut.result()
            done += 1
            uploaded_total += res.get("uploaded", 0)
            error_total    += res.get("errors", 0)
            if res.get("errors") and res.get("detail"):
                print(f"[upsert] ❌ {res['law_id']}: {res['detail']}", flush=True)
            if done % 100 == 0 or done == len(to_process):
                elapsed = time.monotonic() - start
                rate = done / elapsed if elapsed > 0 else 0
                eta  = (len(to_process) - done) / rate if rate > 0 else 0
                print(
                    f"[upsert] {done}/{len(to_process)} done"
                    f" | uploaded={uploaded_total:,} chunks"
                    f" | errors={error_total}"
                    f" | {elapsed:.0f}s elapsed"
                    f" | ETA ~{eta:.0f}s",
                    flush=True,
                )

    elapsed = time.monotonic() - start
    print(
        f"\n[upsert] ✅ Завершено: {done} законів"
        f" | {uploaded_total:,} чанків завантажено"
        f" | {error_total} помилок"
        f" | {elapsed:.0f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
