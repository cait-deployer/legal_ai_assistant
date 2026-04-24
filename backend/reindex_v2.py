"""
reindex_v2.py — Індексує тексти з диску у _v2 колекції Qdrant.
Читає /root/laws_raw/{source}/{law_id}.txt + .meta.json
Використовує gemini-embedding-001 (3072 dims) через embed_v2.py.
17 _v2 колекцій (13 Rada + kmu + ccu + supreme + wiki + positions).

Запуск:
  python reindex_v2.py --source rada    # тільки Rada (рекомендовано)
  python reindex_v2.py --source kmu
  python reindex_v2.py --reset          # скинути стан і почати заново
  python reindex_v2.py --init-only      # тільки створити колекції
Зупинка: Ctrl+C (стан зберігається автоматично)
"""
import os
import sys
import json
import signal
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from langchain_text_splitters import MarkdownTextSplitter, RecursiveCharacterTextSplitter

# ── Config ─────────────────────────────────────────────────────────────────────
RAW_DIR    = os.environ.get("LAWS_RAW_DIR", "/root/laws_raw")
STATE_DIR  = os.path.dirname(os.path.abspath(__file__))
WORKERS    = 4     # паралельні воркери (1 закон = усі його чанки = 1 завдання)
SAVE_EVERY = 20    # зберігати стан кожні N законів

SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions"]

SOURCE_TO_V2_COLLECTION = {
    "kmu":       "laws_kmu_v2",
    "ccu":       "laws_ccu_v2",
    "supreme":   "laws_supreme_v2",
    "wiki":      "laws_wiki_v2",
    "positions": "laws_positions_v2",
}

SPLITTERS = {
    "rada":      MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300),
    "kmu":       MarkdownTextSplitter(chunk_size=4000, chunk_overlap=400),
    "ccu":       RecursiveCharacterTextSplitter(chunk_size=3000, chunk_overlap=300),
    "supreme":   RecursiveCharacterTextSplitter(chunk_size=3000, chunk_overlap=300),
    "wiki":      RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200),
    "positions": RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200),
}

TRUNCATE = {
    "rada": 8000, "kmu": 15000, "ccu": 15000, "supreme": 15000, "wiki": 8000, "positions": 8000,
}

SOURCE_PREFIX = {
    "rada":      "",
    "kmu":       "КМУ: ",
    "ccu":       "КСУ: ",
    "supreme":   "ВС: ",
    "wiki":      "Wiki: ",
    "positions": "Позиція ВС: ",
}

sys.path.insert(0, STATE_DIR)

# ── Shared state ───────────────────────────────────────────────────────────────
_stop       = threading.Event()
_stop_ext   = None   # threading.Event from server.py
_log_cb     = None   # callable(msg, level) from server.py
_print_lock = threading.Lock()


def _log(msg: str, level: str = "info") -> None:
    if _log_cb:
        _log_cb(msg, level)
    else:
        with _print_lock:
            print(msg, flush=True)


def _should_stop() -> bool:
    return _stop.is_set() or (_stop_ext is not None and _stop_ext.is_set())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── State persistence (per-source) ─────────────────────────────────────────────
def _state_file(source: str | None) -> str:
    tag = source if source else "all"
    return os.path.join(STATE_DIR, f"reindex_v2_{tag}_state.json")


def _load_state(source: str | None) -> dict:
    path = _state_file(source)
    if os.path.exists(path):
        try:
            return json.loads(Path(path).read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict, source: str | None) -> None:
    Path(_state_file(source)).write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


# ── File discovery ─────────────────────────────────────────────────────────────
def _discover_files(sources: list[str]) -> list[tuple[str, str, str]]:
    """
    Повертає [(source, law_id, meta_path), ...] відсортованих по source+law_id.
    Включає тільки документи де є і .txt, і .meta.json.
    """
    result = []
    for source in sources:
        src_dir = os.path.join(RAW_DIR, source)
        if not os.path.isdir(src_dir):
            _log(f"  ⚠️ Директорія не знайдена: {src_dir}", "warning")
            continue
        for meta_path in sorted(Path(src_dir).glob("**/*.meta.json")):
            law_id   = str(meta_path.relative_to(src_dir))[: -len(".meta.json")]
            txt_path = meta_path.with_suffix("").with_suffix(".txt")
            if txt_path.exists():
                result.append((source, law_id, str(meta_path)))
    return result


# ── Collection resolution ──────────────────────────────────────────────────────
def _get_collection(source: str, meta: dict) -> str:
    if source == "rada":
        from qdrant_storage import get_v2_collection_for_category
        return get_v2_collection_for_category(meta.get("category", ""))
    return SOURCE_TO_V2_COLLECTION.get(source, "rada_other_v2")


# ── Payload builder ────────────────────────────────────────────────────────────
def _build_payload(meta: dict, chunk_text: str, chunk_idx: int, collection: str) -> dict:
    source = meta.get("source", "rada")
    title  = meta.get("title", "")
    prefix = SOURCE_PREFIX.get(source, "")
    law_url = (
        meta.get("law_url")
        or meta.get("pdf_url")
        or meta.get("url")
        or ""
    )
    return {
        "source":            f"{prefix}{title}",
        "law_id":            meta["law_id"],
        "law_url":           law_url,
        "law_domain":        collection,
        "category":          meta.get("category", ""),
        "doc_type":          meta.get("doc_type", ""),
        "status":            meta.get("status", ""),
        "doc_number":        meta.get("doc_number", ""),
        "author":            meta.get("author", ""),
        "date_adopted":      meta.get("date_adopted", ""),
        "effective_date":    meta.get("effective_date", ""),
        "is_retroactive":    meta.get("is_retroactive", False),
        "wartime_only":      meta.get("wartime_only", False),
        "is_suspended":      meta.get("is_suspended", False),
        "has_transitional":  meta.get("has_transitional", False),
        "scraped_at":        meta.get("scraped_at", ""),
        "chunk_index":       chunk_idx,
        "content":           chunk_text,
    }


# ── Process one law ────────────────────────────────────────────────────────────
def _process_law(source: str, law_id: str, meta_path: str) -> dict:
    """
    Chunks, embeds, and uploads one law. Returns stats dict.
    Safe order: embed first → delete old → upload new.
    On embed failure: old vectors stay intact (no data loss).
    """
    import embed_v2
    from qdrant_storage import upload_to_qdrant, delete_law_chunks

    stats = {"chunks": 0, "uploaded": 0, "errors": 0}

    try:
        meta = json.loads(Path(meta_path).read_text("utf-8"))
    except Exception as ex:
        _log(f"  ❌ meta read {law_id}: {ex}", "error")
        stats["errors"] = 1
        return stats

    txt_path = Path(meta_path).with_suffix("").with_suffix(".txt")
    if not txt_path.exists():
        _log(f"  ⚠️ .txt відсутній: {law_id}", "warning")
        stats["errors"] = 1
        return stats

    try:
        raw_text = txt_path.read_text("utf-8")
    except Exception as ex:
        _log(f"  ❌ txt read {law_id}: {ex}", "error")
        stats["errors"] = 1
        return stats

    collection = _get_collection(source, meta)

    limit = TRUNCATE.get(source, 8000)
    title_prefix = f"# {meta.get('title', '')}\n\n" if meta.get("title") else ""
    body = raw_text[:limit]
    text_for_split = title_prefix + body

    splitter = SPLITTERS[source]
    chunks   = splitter.split_text(text_for_split)

    if not chunks:
        _log(f"  ⚠️ Порожні чанки: {law_id}", "warning")
        return stats

    stats["chunks"] = len(chunks)

    # ── EMBED FIRST — before touching Qdrant ──────────────────────────────────
    # If embed fails, old vectors remain intact (no data loss).
    try:
        vectors = embed_v2.embed_documents(chunks, task="RETRIEVAL_DOCUMENT")
    except Exception as ex:
        _log(f"  ❌ embed {law_id}: {ex}", "error")
        stats["errors"] = len(chunks)
        return stats

    # ── DELETE old chunks only after successful embed ─────────────────────────
    delete_law_chunks(law_id, collection)

    # ── UPLOAD new chunks ─────────────────────────────────────────────────────
    for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
        payload = _build_payload(meta, chunk_text, i, collection)
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

    return stats


# ── Internal run logic ─────────────────────────────────────────────────────────
def _run_main(source: str | None = None, init_only: bool = False, reset: bool = False) -> None:
    from qdrant_storage import init_v2_collections
    init_v2_collections(vector_size=3072)

    if init_only:
        _log("Колекції створено. Виходимо (init-only).")
        return

    sources_to_run = [source] if source else SOURCES

    if reset:
        path = _state_file(source)
        if os.path.exists(path):
            os.unlink(path)
            _log("🔄 Стан скинуто — починаємо заново.", "warning")

    state = _load_state(source)
    if not state:
        state = {
            "file_idx": 0,
            "source":   source,
            "stats": {s: {"laws": 0, "chunks": 0, "uploaded": 0, "errors": 0} for s in sources_to_run},
        }

    # Discover files once (fresh count of files on disk)
    all_files = _discover_files(sources_to_run)
    total     = len(all_files)
    start_idx = state.get("file_idx", 0)

    _log(f"\n{'='*60}")
    _log(f"РЕІНДЕКС V2 [{', '.join(sources_to_run)}]: {total} файлів (старт з {start_idx})")
    _log(f"{'='*60}")

    if start_idx >= total and total > 0:
        _log(f"⚠️ file_idx={start_idx} >= total={total}. Скинь стан (reset) якщо хочеш переіндексувати заново.", "warning")
        return

    processed = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        BATCH = 40
        i = start_idx

        while i < total and not _should_stop():
            batch = all_files[i : i + BATCH]
            futs  = {
                executor.submit(_process_law, src, lid, mp): (j + i, src, lid)
                for j, (src, lid, mp) in enumerate(batch)
            }

            for fut in as_completed(futs):
                if _should_stop():
                    _log("⏸ Отримано сигнал зупинки — завершуємо поточний батч...", "warning")
                    break

                file_i, src, lid = futs[fut]
                try:
                    res = fut.result()
                except Exception as ex2:
                    _log(f"  ❌ {src}/{lid}: {ex2}", "error")
                    res = {"chunks": 0, "uploaded": 0, "errors": 1}

                # Ensure stats key exists (handles per-source runs with loaded state)
                if src not in state["stats"]:
                    state["stats"][src] = {"laws": 0, "chunks": 0, "uploaded": 0, "errors": 0}

                st = state["stats"][src]
                st["laws"]     += 1
                st["chunks"]   += res.get("chunks", 0)
                st["uploaded"] += res.get("uploaded", 0)
                st["errors"]   += res.get("errors", 0)
                processed += 1

                state["file_idx"] = file_i + 1

                chunks_n = res.get("chunks", 0)
                errors_n = res.get("errors", 0)
                icon     = "✅" if errors_n == 0 else "⚠️"
                _log(
                    f"  {icon} [{file_i+1}/{total}] {src}/{lid} — "
                    f"{chunks_n} чанків, {res.get('uploaded', 0)} завантажено"
                    + (f", {errors_n} помилок" if errors_n else "")
                )

                if processed % SAVE_EVERY == 0:
                    _save_state(state, source)
                    total_up = sum(s["uploaded"] for s in state["stats"].values())
                    _log(
                        f"  📊 [{src}] {file_i+1}/{total} | "
                        f"uploaded={total_up} | "
                        f"laws={st['laws']} chunks={st['chunks']} err={st['errors']}"
                    )

            i += BATCH

    _save_state(state, source)

    if _should_stop():
        idx_saved = state.get("file_idx", start_idx)
        total_up  = sum(s.get("uploaded", 0) for s in state["stats"].values())
        _log(f"💾 Стан збережено: позиція {idx_saved}/{total}, всього завантажено {total_up} чанків.", "warning")
        _log(f"⏸ ЗУПИНЕНО о {datetime.now().strftime('%H:%M:%S')} — продовжити можна натиснувши «Продовжити».", "warning")
        return

    _log("\n" + "=" * 60)
    _log(f"🎉 РЕІНДЕКС V2 [{', '.join(sources_to_run)}] ЗАВЕРШЕНО!")
    total_laws = total_chunks = total_up = total_err = 0
    for s in sources_to_run:
        st = state["stats"].get(s, {})
        total_laws   += st.get("laws", 0)
        total_chunks += st.get("chunks", 0)
        total_up     += st.get("uploaded", 0)
        total_err    += st.get("errors", 0)
        _log(
            f"  {s:8s}: laws={st.get('laws',0):>6} chunks={st.get('chunks',0):>7} "
            f"uploaded={st.get('uploaded',0):>7} err={st.get('errors',0):>4}"
        )
    _log(f"  {'ВСЬОГО':8s}: laws={total_laws:>6} chunks={total_chunks:>7} uploaded={total_up:>7} err={total_err:>4}")

    path = _state_file(source)
    if os.path.exists(path):
        os.unlink(path)
    _log("\n▶ Запусти python repair_missing_v2.py для перевірки пропущених чанків")


def run_reindex_v2(
    source: str | None = None,
    log_callback=None,
    stop_event: threading.Event | None = None,
    init_only: bool = False,
    reset: bool = False,
) -> None:
    """Called from server.py. Runs in a daemon thread."""
    global _stop_ext, _log_cb
    _stop_ext = stop_event
    _log_cb   = log_callback
    try:
        _run_main(source=source, init_only=init_only, reset=reset)
    finally:
        _log_cb   = None
        _stop_ext = None


# ── Main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Реіндекс v2: диск → Qdrant _v2 колекції")
    parser.add_argument("--source", choices=SOURCES, help="Тільки одне джерело (рекомендовано)")
    parser.add_argument("--reset",     action="store_true", help="Скинути стан перед запуском")
    parser.add_argument("--init-only", action="store_true", help="Тільки створити _v2 колекції")
    args = parser.parse_args()

    def _on_signal(sig, frame):
        _log("\n⏸ Зупинка... (зберігаємо стан)")
        _stop.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    _run_main(source=args.source, init_only=args.init_only, reset=args.reset)


if __name__ == "__main__":
    main()
