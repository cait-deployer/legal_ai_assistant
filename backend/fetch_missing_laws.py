"""
fetch_missing_laws.py — downloads and indexes critical Ukrainian laws
that are missing from disk / Qdrant.

Run from /home/devops/app/backend:
    python fetch_missing_laws.py          # check + fix all
    python fetch_missing_laws.py --check  # check only, no download
    python fetch_missing_laws.py --id 2755-17  # single law
"""
import argparse
import json
import sys
import time
from pathlib import Path

RAW_DIR = Path("/root/laws_raw/rada")

# ── Critical laws that MUST be present ─────────────────────────────────────────
# Format: (law_id, category_code, human_name)
# category_code → collection mapping is in qdrant_storage.CATEGORY_TO_V2_COLLECTION
CRITICAL_LAWS: list[tuple[str, str, str]] = [
    # Податкове законодавство
    ("2755-17",  "h3",  "Податковий кодекс України"),
    # Цивільне право
    ("435-15",   "h5",  "Цивільний кодекс України"),
    ("1618-15",  "h5",  "Цивільний процесуальний кодекс України"),
    # Трудове право
    ("322-08",   "h19", "Кодекс законів про працю України"),
    # Господарське
    ("436-15",   "h1",  "Господарський кодекс України"),
    ("1798-15",  "h1",  "Господарський процесуальний кодекс України"),
    # Кримінальне
    ("2341-14",  "h25", "Кримінальний кодекс України"),
    ("4651-17",  "h25", "Кримінальний процесуальний кодекс України"),
    # Земельне
    ("2768-14",  "h9",  "Земельний кодекс України"),
    # Підприємництво
    ("2275-17",  "h15", "Закон України про товариства з обмеженою та додатковою відповідальністю"),
    ("514-17",   "h15", "Закон України про підприємництво"),
    # Митне
    ("4495-17",  "h23", "Митний кодекс України"),
    # Адмін
    ("80731-10", "h8",  "Кодекс України про адміністративні правопорушення"),
]


def _check_disk(law_id: str) -> bool:
    return (RAW_DIR / f"{law_id}.txt").exists()


def _check_qdrant(law_id: str) -> int:
    from qdrant_client import QdrantClient
    from qdrant_storage import RADA_V2_COLLECTIONS
    client = QdrantClient("localhost", port=6333)
    total = 0
    for col in RADA_V2_COLLECTIONS:
        try:
            r = client.scroll(
                col,
                scroll_filter={"must": [{"key": "law_id", "match": {"value": law_id}}]},
                limit=1,
                with_payload=False,
                with_vectors=False,
            )
            total += len(r[0])
        except Exception:
            pass
    return total


def _download_law(law_id: str, category: str, name: str) -> bool:
    """Downloads text + metadata, saves to disk. Returns True on success."""
    import rada_scanner

    print(f"  Завантаження тексту {law_id}...")
    for attempt in range(3):
        try:
            text = rada_scanner.get_law_text(law_id)
            break
        except Exception as ex:
            print(f"  ⚠️  спроба {attempt+1}/3: {ex}")
            time.sleep(3)
    else:
        print(f"  ❌ Не вдалося завантажити текст {law_id}")
        return False

    if not text or text == "__RESTRICTED__":
        print(f"  ❌ {law_id}: текст обмежено або порожній")
        return False

    print(f"  Завантаження метаданих {law_id}...")
    try:
        meta_raw = rada_scanner.get_law_metadata(law_id)
    except Exception as ex:
        print(f"  ⚠️  метадані недоступні ({ex}), використовую мінімальні")
        meta_raw = {}

    meta = {
        "law_id":   law_id,
        "title":    meta_raw.get("title") or name,
        "url":      f"https://zakon.rada.gov.ua/laws/show/{law_id}",
        "category": category,
        "source":   "rada",
        "status":   meta_raw.get("status", ""),
        "doc_type": meta_raw.get("doc_type", ""),
        "date":     meta_raw.get("date") or meta_raw.get("doc_date", ""),
        "doc_number": meta_raw.get("doc_number", ""),
    }

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / f"{law_id}.txt").write_text(text, encoding="utf-8")
    (RAW_DIR / f"{law_id}.meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  ✅ Збережено на диск: {len(text):,} символів")
    return True


def _index_law(law_id: str) -> bool:
    """Chunks, embeds, uploads to Qdrant. Returns True on success."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    import reindex_v2

    # Critical laws are large codes — index full text, not just first 8000 chars.
    original_truncate = reindex_v2.TRUNCATE.get("rada")
    reindex_v2.TRUNCATE["rada"] = 1_000_000

    meta_path = str(RAW_DIR / f"{law_id}.meta.json")
    print(f"  Індексування {law_id} (повний текст)...")
    try:
        stats = reindex_v2._process_law("rada", law_id, meta_path)
    finally:
        reindex_v2.TRUNCATE["rada"] = original_truncate

    ok = stats["uploaded"] > 0
    print(f"  {'✅' if ok else '❌'} chunks={stats['chunks']} uploaded={stats['uploaded']} errors={stats['errors']}")
    return ok


def run(check_only: bool = False, single_id: str | None = None):
    laws = CRITICAL_LAWS
    if single_id:
        laws = [(lid, cat, name) for lid, cat, name in CRITICAL_LAWS if lid == single_id]
        if not laws:
            # allow ad-hoc: fetch_missing_laws.py --id X --category h3 --name "..."
            print(f"  ⚠️  {single_id} не в CRITICAL_LAWS, але перевіряємо")
            laws = [(single_id, "h3", single_id)]

    print(f"\n{'='*60}")
    print(f"  Перевірка {len(laws)} критичних законів")
    print(f"{'='*60}\n")

    missing_disk:   list[tuple[str, str, str]] = []
    missing_qdrant: list[tuple[str, str, str]] = []

    for law_id, category, name in laws:
        on_disk  = _check_disk(law_id)
        in_qdrant = _check_qdrant(law_id)
        status = []
        if not on_disk:
            status.append("НЕ НА ДИСКУ")
            missing_disk.append((law_id, category, name))
        if in_qdrant == 0:
            status.append("НЕ В QDRANT")
            missing_qdrant.append((law_id, category, name))

        icon = "✅" if not status else "❌"
        chunks_str = f"({in_qdrant} chunks)" if in_qdrant > 0 else ""
        print(f"  {icon} {law_id:15s} {name[:45]:<45} {' | '.join(status)} {chunks_str}")

    print(f"\n  Відсутніх на диску:  {len(missing_disk)}")
    print(f"  Відсутніх у Qdrant: {len(missing_qdrant)}")

    if check_only:
        return

    # Download missing from disk
    for law_id, category, name in missing_disk:
        print(f"\n{'─'*50}")
        print(f"  ⬇️  {law_id} — {name}")
        ok = _download_law(law_id, category, name)
        if not ok:
            print(f"  ⏭️  Пропускаємо індексацію {law_id}")
            continue
        _index_law(law_id)
        time.sleep(1)

    # Index laws in Qdrant that are on disk but not indexed
    disk_only = [
        (lid, cat, nm) for lid, cat, nm in missing_qdrant
        if (lid, cat, nm) not in missing_disk  # already handled above
    ]
    for law_id, category, name in disk_only:
        print(f"\n{'─'*50}")
        print(f"  📥 {law_id} — {name} (є на диску, індексуємо)")
        _index_law(law_id)
        time.sleep(1)

    print(f"\n{'='*60}")
    print("  Готово!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check",    action="store_true", help="check only, no download")
    parser.add_argument("--id",       default=None,        help="process single law_id")
    args = parser.parse_args()
    run(check_only=args.check, single_id=args.id)
