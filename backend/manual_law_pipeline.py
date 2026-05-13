from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


RAW_DIR = os.environ.get("LAWS_RAW_DIR", "/root/laws_raw")
LAW_ID_RE = re.compile(r"^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_.%-]+$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(log_callback: Callable[[str, str], None] | None, message: str, level: str = "info") -> None:
    if log_callback:
        log_callback(message, level)


def _raw_path(law_id: str, suffix: str) -> Path:
    return Path(RAW_DIR) / "rada" / f"{law_id}{suffix}"


def _extract_title(text: str, fallback: str) -> str:
    for raw in text.splitlines():
        line = raw.strip().lstrip("#").strip()
        if not line:
            continue
        upper = line.upper()
        if upper in {"ЗАКОН УКРАЇНИ", "ПОСТАНОВА", "УКАЗ", "НАКАЗ"}:
            continue
        if len(line) > 220:
            continue
        return line
    return fallback


def _date_to_iso(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return value


def _status_is_dead(status: str) -> bool:
    normalized = (status or "").lower()
    return any(marker in normalized for marker in ("втратив", "нечин", "скасован"))


def _enrich_rada_meta(meta: dict, text: str, category: str) -> dict:
    law_id = meta["law_id"]
    title = meta.get("title") or _extract_title(text, law_id)
    adopted = _date_to_iso(meta.get("date_adopted"))
    effective = _date_to_iso(meta.get("effective_date"))
    status = meta.get("status", "")

    enriched = {
        **meta,
        "title": title,
        "category": category,
        "source": "rada",
        "law_url": meta.get("law_url") or f"https://zakon.rada.gov.ua/laws/show/{law_id}",
        "scraped_at": meta.get("scraped_at") or _now(),
        "date_adopted": adopted or meta.get("date_adopted", ""),
        "effective_date": effective or meta.get("effective_date", ""),
        "rada_nreg": law_id,
        "rada_title": title,
        "rada_url": meta.get("law_url") or f"https://zakon.rada.gov.ua/laws/show/{law_id}",
        "rada_status_name": status,
        "rada_is_dead": _status_is_dead(status),
        "rada_doc_type": meta.get("doc_type", ""),
        "rada_adopted_date": adopted,
        "rada_effective_date": effective,
        "rada_enriched_at": meta.get("rada_enriched_at") or _now(),
        "rada_enrichment_source": meta.get("rada_enrichment_source") or "manual_rada_pipeline",
    }
    return enriched


def _enrich_from_opendata(law_id: str, log_callback: Callable[[str, str], None] | None = None) -> dict:
    try:
        from enrich_opendata_meta import _build_enriched, _fetch_card

        started = time.monotonic()
        card, status = _fetch_card(law_id)
        if not card:
            _log(log_callback, f"OpenData card not applied: {status}", "warning")
            return {}
        enriched = _build_enriched(law_id, card, {}, {})
        _log(log_callback, f"OpenData card applied in {time.monotonic() - started:.1f}s")
        return enriched
    except Exception as exc:
        _log(log_callback, f"OpenData targeted enrichment skipped: {exc}", "warning")
        return {}


def _save_raw_law(law_id: str, text: str, meta: dict) -> Path:
    raw_dir = Path(RAW_DIR) / "rada"
    raw_dir.mkdir(parents=True, exist_ok=True)
    txt_path = raw_dir / f"{law_id}.txt"
    meta_path = raw_dir / f"{law_id}.meta.json"
    txt_path.write_text(text, "utf-8")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
    return meta_path


def _update_scrape_status(law_id: str, category: str, title: str) -> None:
    status_path = Path(RAW_DIR) / "scrape_status.json"
    try:
        status = json.loads(status_path.read_text("utf-8")) if status_path.exists() else {}
    except Exception:
        status = {}
    source_state = status.setdefault("rada", {})
    source_state[law_id] = {
        "status": "done",
        "category": category,
        "title": title,
        "updated_at": _now(),
        "manual": True,
    }
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2), "utf-8")


def run_manual_rada_law_pipeline(
    law_id: str,
    category: str,
    *,
    force: bool = True,
    log_callback: Callable[[str, str], None] | None = None,
    stop_check: Callable[[], bool] | None = None,
    rebuild_registry: Callable[[Callable[[str, str], None]], None] | None = None,
) -> dict:
    law_id = law_id.strip()
    category = (category or "h2").strip().lower()

    if not LAW_ID_RE.match(law_id):
        raise ValueError("Invalid Rada document id")

    from qdrant_storage import CATEGORY_TO_V2_COLLECTION, get_v2_collection_for_category

    if category not in CATEGORY_TO_V2_COLLECTION:
        raise ValueError(f"Unknown Rada category: {category}")

    def stopped() -> bool:
        return bool(stop_check and stop_check())

    _log(log_callback, f"Manual law pipeline started: {law_id} ({category})")

    txt_path = _raw_path(law_id, ".txt")
    meta_path = _raw_path(law_id, ".meta.json")
    if txt_path.exists() and meta_path.exists() and not force:
        _log(log_callback, "Raw file already exists, using cached copy")
        text = txt_path.read_text("utf-8")
        meta = json.loads(meta_path.read_text("utf-8"))
    else:
        if stopped():
            return {"law_id": law_id, "status": "stopped"}
        _log(log_callback, "Step 1/5: fetching text from zakon.rada.gov.ua")
        from rada_scanner import BASE, detect_text_flags, get_law_metadata, get_law_text

        started = time.monotonic()
        text = get_law_text(law_id)
        if not text or text == "__RESTRICTED__":
            raise RuntimeError("Rada returned empty or restricted text")
        _log(log_callback, f"Text fetched: {len(text):,} chars in {time.monotonic() - started:.1f}s")

        _log(log_callback, "Fetching Rada page metadata")
        meta_started = time.monotonic()
        law_meta = get_law_metadata(law_id)
        flags = detect_text_flags(text)
        meta = {
            "law_id": law_id,
            "title": "",
            "source": "rada",
            "category": category,
            "effective_date": law_meta.get("effective_date", ""),
            "law_url": f"{BASE}/laws/show/{law_id}",
            "status": law_meta.get("status", ""),
            "doc_number": law_meta.get("doc_number", ""),
            "doc_type": law_meta.get("doc_type", ""),
            "author": law_meta.get("author", ""),
            "date_adopted": law_meta.get("date_adopted", ""),
            "scraped_at": _now(),
            **flags,
        }
        _log(log_callback, f"Rada metadata fetched in {time.monotonic() - meta_started:.1f}s")
        meta = {
            **meta,
            "title": meta.get("title") or _extract_title(text, law_id),
            "category": category,
            "source": "rada",
            "law_url": meta.get("law_url") or f"https://zakon.rada.gov.ua/laws/show/{law_id}",
        }
        meta_path = _save_raw_law(law_id, text, meta)
        _update_scrape_status(law_id, category, meta.get("title", law_id))
        _log(log_callback, f"Scrape saved: {law_id}.txt + {law_id}.meta.json")

    if stopped():
        return {"law_id": law_id, "status": "stopped"}
    _log(log_callback, "Step 2/5: targeted OpenData metadata enrichment")
    opendata_meta = _enrich_from_opendata(law_id, log_callback)
    if opendata_meta:
        meta = {**meta, **opendata_meta, "rada_enrichment_source": "opendata_card"}

    _log(log_callback, "Step 3/5: fallback metadata normalization")
    meta = _enrich_rada_meta(meta, text, category)
    meta_path = _save_raw_law(law_id, text, meta)
    enriched_keys = sorted(k for k in meta if k.startswith("rada_"))
    _log(log_callback, f"Metadata ready: {len(enriched_keys)} rada_* fields")

    if stopped():
        return {"law_id": law_id, "status": "stopped"}
    _log(log_callback, "Step 4/5: reindexing only this document")
    from reindex_v2 import _process_law

    stats = _process_law("rada", law_id, str(meta_path))
    if stats.get("errors"):
        raise RuntimeError(f"Reindex finished with errors: {stats}")
    _log(log_callback, f"Chunks: {stats.get('chunks', 0)}, uploaded: {stats.get('uploaded', 0)}")

    collection = get_v2_collection_for_category(category)
    _log(log_callback, f"Qdrant payload uploaded to {collection}")

    if stopped():
        return {"law_id": law_id, "status": "stopped", "collection": collection, "stats": stats}
    if rebuild_registry:
        _log(log_callback, "Step 5/5: rebuilding document registry")
        rebuild_registry(lambda msg, level="info": _log(log_callback, msg, level))

    result = {
        "law_id": law_id,
        "status": "done",
        "title": meta.get("title", law_id),
        "category": category,
        "collection": collection,
        "stats": stats,
        "law_url": meta.get("law_url", ""),
        "metadata_fields": enriched_keys,
    }
    _log(log_callback, f"Manual law pipeline finished: {law_id}")
    return result
