"""
Fast document-level registry for Qdrant V2 collections.

The chat retrieval pipeline needs a cheap way to find the right document by
metadata before fetching chunks. Qdrant currently has text indexes only for
`content` and `source`, while Rada/KMU expose rich status/title metadata in the
payload. This module builds a compact one-row-per-document index from
`chunk_index == 0` payloads and searches it in memory.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from qdrant_client.models import FieldCondition, Filter, MatchValue


BASE_DIR = Path(__file__).parent
REGISTRY_FILE = BASE_DIR / "document_registry_v2.json"

REGISTRY_VERSION = 1
SCROLL_BATCH = 512

PRIMARY_COLLECTIONS = {
    "laws_kmu_v2",
    "laws_mod_v2",
}

SECONDARY_COLLECTIONS = {
    "laws_zir_v2",
    "laws_supreme_v2",
    "laws_ccu_v2",
    "laws_positions_v2",
    "laws_wiki_v2",
}

DEAD_QUERY_TERMS = {
    "втратив", "втратила", "втратило", "скасовано", "скасована", "скасований",
    "нечинний", "нечинна", "історія", "історичний", "діяв", "діяла",
    "чинність", "архів", "архівний",
}

DOC_TYPE_WEIGHTS = {
    "кодекс": 1.35,
    "закон": 1.25,
    "постанова": 1.15,
    "порядок": 1.12,
    "наказ": 1.08,
    "розпорядження": 1.02,
    "правова позиція": 0.82,
    "огляд судової практики": 0.78,
    "стаття wiki": 0.58,
}

SOURCE_ROLE_WEIGHTS = {
    "primary_norm": 1.12,
    "official_norm": 1.02,
    "tax_consultation": 0.86,
    "court_practice": 0.78,
    "explanation": 0.55,
}


_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, Any] | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(_clean_text(v) for v in value)
    return str(value).strip()


def _norm(value: Any) -> str:
    text = _clean_text(value).lower().replace("ґ", "г")
    text = re.sub(r"[^\wа-щьюяєії0-9'-]+", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(value: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for tok in _norm(value).split():
        if len(tok) < 4 and not re.search(r"\d", tok):
            continue
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def _source_role(collection: str) -> str:
    if collection.startswith("rada_") or collection == "laws_kmu_v2":
        return "primary_norm"
    if collection == "laws_mod_v2":
        return "official_norm"
    if collection == "laws_zir_v2":
        return "tax_consultation"
    if collection in {"laws_supreme_v2", "laws_ccu_v2", "laws_positions_v2"}:
        return "court_practice"
    if collection == "laws_wiki_v2":
        return "explanation"
    return "secondary"


def _pick_title(payload: dict[str, Any]) -> str:
    return (
        _clean_text(payload.get("rada_title"))
        or _clean_text(payload.get("title"))
        or _clean_text(payload.get("source"))
    )


def _record_from_payload(collection: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    law_id = _clean_text(payload.get("law_id"))
    if not law_id:
        return None

    title = _pick_title(payload)
    source = _clean_text(payload.get("source"))
    doc_type = _clean_text(payload.get("rada_doc_type")) or _clean_text(payload.get("doc_type"))
    status_name = _clean_text(payload.get("rada_status_name")) or _clean_text(payload.get("status"))
    is_dead = bool(payload.get("rada_is_dead")) or status_name.lower() in {
        "втратив чинність", "нечинний", "скасовано"
    }

    search_text = " ".join(
        _clean_text(payload.get(k))
        for k in (
            "law_id", "rada_nreg", "source", "rada_title", "title", "doc_type",
            "rada_doc_type", "rada_doc_types", "category", "rada_theme",
            "rada_classifiers", "rada_org", "author", "status", "rada_status_name",
        )
    )

    return {
        "collection": collection,
        "law_id": law_id,
        "title": title or source or law_id,
        "source": source or title or law_id,
        "url": _clean_text(payload.get("rada_url")) or _clean_text(payload.get("law_url")),
        "doc_type": doc_type,
        "doc_types": _clean_text(payload.get("rada_doc_types")),
        "category": _clean_text(payload.get("category")),
        "theme": _clean_text(payload.get("rada_theme")),
        "classifiers": _clean_text(payload.get("rada_classifiers")),
        "org": _clean_text(payload.get("rada_org")) or _clean_text(payload.get("author")),
        "status": payload.get("rada_status", payload.get("status", "")),
        "status_name": status_name,
        "is_dead": is_dead,
        "dead_since": _clean_text(payload.get("rada_dead_since")),
        "last_edition": _clean_text(payload.get("rada_last_edition")),
        "adopted_date": _clean_text(payload.get("rada_adopted_date")) or _clean_text(payload.get("date_adopted")),
        "replaced_by": payload.get("rada_replaced_by") or [],
        "source_role": _source_role(collection),
        "search_text": _norm(search_text),
    }


def build_document_registry(
    collections: Iterable[str],
    *,
    log_callback: Callable[[str, str], None] | None = None,
    stop_event: threading.Event | None = None,
) -> dict[str, Any]:
    """Build and persist document registry from Qdrant payloads."""
    from qdrant_storage import ensure_metadata_indexes, get_client

    def log(msg: str, level: str = "info") -> None:
        if log_callback:
            log_callback(msg, level)
        else:
            print(msg, flush=True)

    client = get_client()
    started = time.monotonic()
    records: list[dict[str, Any]] = []
    by_doc: dict[tuple[str, str], dict[str, Any]] = {}
    collections = list(collections)

    try:
        ensure_metadata_indexes(collections)
    except Exception as exc:
        log(f"[doc registry] metadata index warning: {exc}", "warning")

    payload_fields = [
        "source", "title", "law_id", "law_url", "law_domain", "category",
        "doc_type", "status", "doc_number", "author", "date_adopted",
        "effective_date", "scraped_at", "chunk_index",
        "rada_title", "rada_url", "rada_nreg", "rada_doc_type",
        "rada_doc_types", "rada_status", "rada_status_name", "rada_is_dead",
        "rada_dead_since", "rada_last_edition", "rada_replaced_by",
        "rada_theme", "rada_classifiers", "rada_org", "rada_adopted_date",
    ]

    for collection in collections:
        if stop_event and stop_event.is_set():
            log("[doc registry] stop requested", "warning")
            break

        offset = None
        collection_count = 0
        scroll_filter = Filter(
            must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        )
        while True:
            if stop_event and stop_event.is_set():
                break
            points, next_offset = client.scroll(
                collection_name=collection,
                scroll_filter=scroll_filter,
                limit=SCROLL_BATCH,
                offset=offset,
                with_payload=payload_fields,
                with_vectors=False,
            )
            for point in points:
                record = _record_from_payload(collection, point.payload or {})
                if not record:
                    continue
                key = (record["collection"], record["law_id"])
                if key not in by_doc:
                    by_doc[key] = record
                    records.append(record)
                    collection_count += 1
            if not next_offset:
                break
            offset = next_offset

        log(f"[doc registry] {collection}: {collection_count:,} docs", "info")

    payload = {
        "__meta__": {
            "version": REGISTRY_VERSION,
            "built_at": _now_iso(),
            "elapsed_sec": round(time.monotonic() - started, 2),
            "doc_count": len(records),
            "collections": collections,
        },
        "documents": records,
    }
    REGISTRY_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    global _CACHE
    with _CACHE_LOCK:
        _CACHE = payload

    log(f"[doc registry] saved {len(records):,} docs to {REGISTRY_FILE.name}", "success")
    return payload


def load_document_registry() -> dict[str, Any] | None:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if not REGISTRY_FILE.exists():
        return None
    try:
        data = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("documents"), list):
        return None
    with _CACHE_LOCK:
        _CACHE = data
    return data


def registry_status() -> dict[str, Any]:
    data = load_document_registry()
    if not data:
        return {"exists": False, "path": str(REGISTRY_FILE)}
    meta = data.get("__meta__", {})
    return {
        "exists": True,
        "path": str(REGISTRY_FILE),
        "doc_count": meta.get("doc_count", len(data.get("documents", []))),
        "built_at": meta.get("built_at"),
        "version": meta.get("version"),
        "collections": meta.get("collections", []),
    }


def search_document_registry(
    keywords: list[str],
    collections: Iterable[str],
    *,
    limit: int = 30,
) -> list[dict[str, Any]]:
    data = load_document_registry()
    if not data:
        return []

    wanted_collections = set(collections)
    query_text = " ".join(keywords)
    query_norm = _norm(query_text)
    query_tokens = _tokens(query_text)
    if not query_tokens:
        return []

    allow_dead = any(term in query_norm for term in DEAD_QUERY_TERMS)
    phrase_candidates = [
        _norm(k) for k in keywords
        if len(_norm(k).split()) >= 2 and len(_norm(k)) >= 8
    ]

    hits: list[dict[str, Any]] = []
    for doc in data.get("documents", []):
        collection = doc.get("collection", "")
        if wanted_collections and collection not in wanted_collections:
            continue

        search_text = doc.get("search_text") or _norm(
            f"{doc.get('title', '')} {doc.get('source', '')} {doc.get('doc_type', '')} "
            f"{doc.get('theme', '')} {doc.get('category', '')} {doc.get('org', '')} {doc.get('law_id', '')}"
        )
        title_text = _norm(f"{doc.get('title', '')} {doc.get('source', '')}")

        title_matches = [t for t in query_tokens if t in title_text]
        all_matches = [t for t in query_tokens if t in search_text]
        if not all_matches:
            continue

        phrase_score = 0.0
        for phrase in phrase_candidates:
            if phrase and phrase in search_text:
                phrase_score += 2.5

        coverage = len(set(all_matches)) / max(len(set(query_tokens)), 1)
        title_coverage = len(set(title_matches)) / max(len(set(query_tokens)), 1)
        score = 0.30 + coverage * 0.35 + title_coverage * 0.45 + phrase_score

        law_id = _norm(doc.get("law_id", ""))
        if law_id and any(tok == law_id or tok in law_id for tok in query_tokens):
            score += 0.35

        doc_type = _norm(doc.get("doc_type") or doc.get("doc_types") or "")
        for marker, weight in DOC_TYPE_WEIGHTS.items():
            if marker in doc_type:
                score *= weight
                break

        score *= SOURCE_ROLE_WEIGHTS.get(doc.get("source_role", ""), 0.72)

        if doc.get("is_dead") and not allow_dead:
            score *= 0.42

        if not title_matches and doc.get("source_role") in {"court_practice", "explanation"}:
            score *= 0.62

        if score < 0.35:
            continue

        hit = dict(doc)
        hit["_registry_score"] = round(score, 4)
        hit["_registry_matches"] = sorted(set(all_matches))[:12]
        hit["_registry_title_matches"] = sorted(set(title_matches))[:12]
        hits.append(hit)

    hits.sort(
        key=lambda d: (
            -float(d.get("_registry_score", 0.0)),
            1 if d.get("is_dead") else 0,
            d.get("collection", ""),
            d.get("law_id", ""),
        )
    )
    return hits[:limit]
