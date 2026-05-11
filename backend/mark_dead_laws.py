"""
mark_dead_laws.py — встановлює rada_is_dead=True для вказаних law_id у Qdrant
та оновлює їхні .meta.json файли.

Використання:
    python mark_dead_laws.py --law-ids 80731-10 80732-10
    python mark_dead_laws.py --law-ids 80731-10 80732-10 --source kmu  # якщо не rada
    python mark_dead_laws.py --dry-run --law-ids 80731-10 80732-10

Причина: 80731-10 і 80732-10 — старі редакції КУпАП "до 07.05.2017", вони
є historical snapshots і суперечать актуальній версії 8073-10. LLM бачить обидві
версії і видає відповідь "неможливо визначити однозначно".
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

RAW_BASE = Path("/root/laws_raw")
DEAD_PAYLOAD = {
    "rada_is_dead": True,
    "rada_is_dead_by_status": True,
    "rada_status": "dead",
    "rada_status_name": "Втратив чинність (редакція)",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def patch_qdrant(law_ids: list[str], source: str, dry_run: bool) -> None:
    from qdrant_storage import get_client, RADA_V2_COLLECTIONS, OTHER_V2_COLLECTIONS

    if source == "rada":
        collections = RADA_V2_COLLECTIONS
    else:
        collections = [c for c in OTHER_V2_COLLECTIONS if source in c]

    client = get_client()
    law_id_set = set(law_ids)
    total_patched = 0

    for coll in collections:
        # Scroll to find all point IDs for these law_ids
        law_to_ids: dict[str, list] = {}
        offset = None
        while True:
            results, next_offset = client.scroll(
                collection_name=coll,
                scroll_filter=None,
                limit=1000,
                offset=offset,
                with_payload=["law_id"],
                with_vectors=False,
            )
            for pt in results:
                lid = (pt.payload or {}).get("law_id")
                if lid in law_id_set:
                    law_to_ids.setdefault(lid, []).append(pt.id)
            offset = next_offset
            if offset is None:
                break

        if not law_to_ids:
            continue

        for law_id, ids in law_to_ids.items():
            print(f"  [{coll}] {law_id}: {len(ids)} chunks → rada_is_dead=True", flush=True)
            if dry_run:
                continue
            for attempt in range(3):
                try:
                    client.set_payload(
                        collection_name=coll,
                        payload={**DEAD_PAYLOAD, "dead_marked_at": _now()},
                        points=ids,
                    )
                    total_patched += len(ids)
                    break
                except Exception as ex:
                    if attempt == 2:
                        print(f"  ERROR [{coll}/{law_id}]: {ex}", flush=True)
                    else:
                        time.sleep(2 ** attempt)

    if dry_run:
        print("Dry run — Qdrant не змінено.", flush=True)
    else:
        print(f"\nQdrant: оновлено {total_patched} chunks.", flush=True)


def patch_meta_json(law_ids: list[str], source: str, dry_run: bool) -> None:
    src_dir = RAW_BASE / source
    for law_id in law_ids:
        meta_path = src_dir / f"{law_id}.meta.json"
        if not meta_path.exists():
            print(f"  meta.json не знайдено: {meta_path}", flush=True)
            continue
        meta = json.loads(meta_path.read_text("utf-8"))
        meta.update({**DEAD_PAYLOAD, "dead_marked_at": _now()})
        print(f"  meta.json [{law_id}]: rada_is_dead=True", flush=True)
        if not dry_run:
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")

    if dry_run:
        print("Dry run — meta.json не змінено.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Mark laws as dead in Qdrant and meta.json")
    parser.add_argument("--law-ids", nargs="+", required=True, metavar="ID")
    parser.add_argument("--source", default="rada", choices=["rada", "kmu"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Law IDs: {args.law_ids}", flush=True)
    print(f"Source:  {args.source}", flush=True)
    print(f"Dry run: {args.dry_run}", flush=True)
    print()

    print("=== meta.json ===", flush=True)
    patch_meta_json(args.law_ids, args.source, args.dry_run)

    print("\n=== Qdrant ===", flush=True)
    patch_qdrant(args.law_ids, args.source, args.dry_run)

    print("\nГотово.", flush=True)


if __name__ == "__main__":
    main()
