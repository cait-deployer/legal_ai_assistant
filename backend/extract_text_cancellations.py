"""
Evidence-based extraction of document cancellations from already downloaded text.

The extractor scans local .txt documents, finds cancellation sections, extracts
nreg-like identifiers only from those sections, classifies full vs partial
cancellation, and writes text_cancellations_cache.json for later meta enrichment.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import requests
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


BACKEND = Path(__file__).parent
RAW_BASE = Path(os.environ.get("LAWS_RAW_DIR", "/root/laws_raw"))
if not RAW_BASE.exists():
    local_raw = BACKEND / "laws_raw"
    if local_raw.exists():
        RAW_BASE = local_raw

CACHE_FILE = BACKEND / "text_cancellations_cache.json"
STATE_FILE = BACKEND / "text_cancellations_state.json"
MISSING_REPORT_FILE = BACKEND / "text_cancellations_missing_report.json"
PARTIAL_REPORT_FILE = BACKEND / "text_cancellations_partial_report.json"
OPENDATA_REPORT_FILE = BACKEND / "text_cancellations_missing_opendata_report.json"
OPENDATA_STATE_FILE = BACKEND / "text_cancellations_missing_opendata_state.json"

SOURCES = ["rada", "kmu"]

CANCEL_MARKERS = (
    "визнати такими, що втратили чинність",
    "визнати таким, що втратив чинність",
    "визнати такою, що втратила чинність",
    "визнати такими, що втратили актуальність",
    "визнати таким, що втратив актуальність",
    "визнати такою, що втратила актуальність",
    "визнати недійсним",
    "визнати недійсними",
    "скасувати",
    "відкликати",
)

TITLE_MARKERS = (
    "втратили чинність",
    "втратив чинність",
    "втратила чинність",
    "втратили актуальність",
    "втратив актуальність",
    "скасування",
    "скасувати",
    "визнання недійсним",
    "визнати недійсним",
)

PARTIAL_MARKERS = (
    "пункт", "пункти", "підпункт", "підпункти", "абзац", "абзаци",
    "частину", "частини", "розділ", "розділи", "главу", "глави",
    "статтю", "статті", "додаток", "додатки", "слова", "цифри",
    "позицію", "позиції", "рядок", "рядки",
)

SECTION_STOP_RE = re.compile(
    r"(?im)^\s*(?:\d+[\).\s]|[IVXLCDM]+[\).\s]|ця\s+(?:постанова|наказ|ухвала|рішення)|"
    r"контроль\s+за\s+виконанням|зареєстровано|голова|міністр|директор)\b"
)

# Rada nreg identifiers are mostly ASCII, but KMU ids can end with Cyrillic
# suffixes: 663-99-п, 98-2011-п, v0490500-98, z0218-98.
NREG_RE = re.compile(
    r"\(\s*([A-Za-z\u0400-\u04FF]{0,4}\d[A-Za-z\u0400-\u04FF\d_./%-]*-\d{2,4}"
    r"(?:-[A-Za-z\u0400-\u04FF]+)?)\s*\)"
)

_stop_event: threading.Event | None = None
_log_fn = print
_lock = threading.Lock()


def _log(msg: str, level: str = "info") -> None:
    with _lock:
        _log_fn(msg, level) if _log_fn != print else print(msg)


def _save_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _save_check_state(state: dict[str, Any]) -> None:
    OPENDATA_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_text(path: Path) -> str:
    for enc in ("utf-8", "cp1251"):
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="ignore")


def _write_report(path: Path, records: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    counts: dict[str, int] = Counter(str(r.get("cancelled_nreg", "")) for r in records if r.get("cancelled_nreg"))
    unique = len(counts)
    top = [{"nreg": nreg, "count": count} for nreg, count in counts.most_common(100)]
    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "kind": kind,
        "total_records": len(records),
        "unique_nregs": unique,
        "top": top,
        "records": records,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def _candidate_aliases(source: str, nreg: str) -> set[str]:
    aliases = {nreg}
    if source == "kmu":
        if nreg.startswith("kmu_"):
            aliases.add(nreg[4:])
        else:
            aliases.add(f"kmu_{nreg}")
    return aliases


def _sentence_around(text: str, start: int, end: int) -> str:
    left = max(text.rfind(".", 0, start), text.rfind(";", 0, start), text.rfind("\n", 0, start))
    right_candidates = [p for p in (text.find(".", end), text.find(";", end), text.find("\n", end)) if p != -1]
    right = min(right_candidates) if right_candidates else min(len(text), end + 250)
    return text[left + 1:right].strip()


def _is_partial(sentence: str) -> bool:
    s = _norm(sentence)
    return any(marker in s for marker in PARTIAL_MARKERS)


def _source_title(txt_path: Path) -> str:
    meta_path = txt_path.parent / f"{txt_path.stem}.meta.json"
    meta = _read_json(meta_path) if meta_path.exists() else {}
    return (
        meta.get("rada_title")
        or meta.get("title")
        or meta.get("source")
        or txt_path.stem
    )


def _candidate_paths(sources: list[str]) -> list[tuple[str, Path, str]]:
    result: list[tuple[str, Path, str]] = []
    for source in sources:
        src_dir = RAW_BASE / source
        if not src_dir.exists():
            _log(f"[text cancellations] Source dir not found: {src_dir}", "warning")
            continue
        for path in sorted(src_dir.glob("*.txt")):
            if path.stem.startswith("_"):
                continue
            title = _source_title(path)
            title_l = _norm(title)
            if any(marker in title_l for marker in TITLE_MARKERS):
                result.append((source, path, title))
                continue

            # Neutral titles can still contain cancellation sections.
            try:
                head = _read_text(path)[:12000]
                if any(marker in _norm(head) for marker in CANCEL_MARKERS):
                    result.append((source, path, title))
            except Exception:
                continue
    return result


def _find_cancellation_sections(text: str) -> list[tuple[int, int, str]]:
    sections: list[tuple[int, int, str]] = []
    for marker in CANCEL_MARKERS:
        pattern = re.compile(re.escape(marker), re.IGNORECASE)
        for match in pattern.finditer(text):
            start = match.start()
            next_stop = SECTION_STOP_RE.search(text, match.end())
            end = next_stop.start() if next_stop else min(len(text), match.end() + 8000)
            sections.append((start, min(end, start + 12000), marker))

    sections.sort(key=lambda x: (x[0], x[1]))
    merged: list[tuple[int, int, str]] = []
    for start, end, marker in sections:
        if not merged or start > merged[-1][1]:
            merged.append((start, end, marker))
        elif end > merged[-1][1]:
            old_start, _, old_marker = merged[-1]
            merged[-1] = (old_start, end, old_marker)
    return merged


def _extract_from_file(
    source: str,
    path: Path,
    title: str,
    known_aliases: dict[str, str],
) -> list[dict[str, Any]]:
    text = _read_text(path)
    sections = _find_cancellation_sections(text)
    found: list[dict[str, Any]] = []
    source_nreg = path.stem

    for sec_start, sec_end, marker in sections:
        section = text[sec_start:sec_end]
        for match in NREG_RE.finditer(section):
            raw_cancelled = match.group(1).strip()
            cancelled = known_aliases.get(raw_cancelled, raw_cancelled)
            if cancelled == source_nreg:
                continue

            absolute_start = sec_start + match.start()
            absolute_end = sec_start + match.end()
            sentence = _sentence_around(text, absolute_start, absolute_end)
            kind = "partial" if _is_partial(sentence) else "full"
            confidence = "partial" if kind == "partial" else "high"
            exists_locally = cancelled in known_aliases.values()

            evidence_start = max(sec_start, absolute_start - 220)
            evidence_end = min(sec_end, absolute_end + 280)
            evidence = re.sub(r"\s+", " ", text[evidence_start:evidence_end]).strip()

            found.append({
                "cancelled_nreg": cancelled,
                "raw_cancelled_nreg": raw_cancelled,
                "by": source_nreg,
                "source": source,
                "source_title": title,
                "marker": marker,
                "kind": kind,
                "confidence": confidence,
                "exists_locally": exists_locally,
                "evidence": evidence[:600],
            })

    return found


def run_extract(
    log_callback=print,
    stop_event: threading.Event | None = None,
    sources: list[str] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Entry point for server.py and CLI."""
    global _stop_event, _log_fn
    _stop_event = stop_event
    _log_fn = log_callback

    if sources is None:
        sources = SOURCES

    started = time.time()
    state: dict[str, Any] = {
        "running": True,
        "phase": "scan",
        "dry_run": dry_run,
        "sources": sources,
        "started_at": datetime.utcnow().isoformat(),
        "stats": {},
    }
    _save_state(state)

    try:
        known_aliases: dict[str, str] = {}
        for source in sources:
            src_dir = RAW_BASE / source
            if not src_dir.exists():
                continue
            for path in src_dir.glob("*.txt"):
                if path.stem.startswith("_"):
                    continue
                for alias in _candidate_aliases(source, path.stem):
                    known_aliases[alias] = path.stem

        candidates = _candidate_paths(sources)
        _log(
            f"[text cancellations] Start | raw_base={RAW_BASE} | sources={','.join(sources)} "
            f"| candidates={len(candidates)} | known_docs={len(set(known_aliases.values()))} | dry_run={dry_run}"
        )

        cache: dict[str, list[dict[str, Any]]] = defaultdict(list)
        partial: list[dict[str, Any]] = []
        missing: list[dict[str, Any]] = []
        stats = Counter()
        examples: list[dict[str, Any]] = []

        log_every = max(25, len(candidates) // 50) if candidates else 25
        for idx, (source, path, title) in enumerate(candidates, start=1):
            if stop_event and stop_event.is_set():
                _log(f"[text cancellations] Stop requested at {idx}/{len(candidates)}", "warning")
                break

            try:
                records = _extract_from_file(source, path, title, known_aliases)
            except Exception as exc:
                stats["errors"] += 1
                _log(f"[text cancellations] ERROR {path.name}: {exc}", "error")
                continue

            stats["files_scanned"] += 1
            if records:
                stats["files_with_hits"] += 1

            for rec in records:
                stats["raw_hits"] += 1
                if rec["kind"] == "partial":
                    stats["partial_hits"] += 1
                    partial.append(rec)
                    continue
                if not rec["exists_locally"]:
                    stats["missing_locally"] += 1
                    missing.append(rec)
                    continue

                stats["full_high_hits"] += 1
                cancelled = rec.pop("cancelled_nreg")
                cache[cancelled].append(rec)
                if len(examples) < 15:
                    examples.append({"cancelled_nreg": cancelled, **rec})

            if idx % log_every == 0 or idx == len(candidates):
                elapsed = time.time() - started
                speed = round(idx / elapsed, 1) if elapsed > 0 else 0
                _log(
                    f"[text cancellations] {idx}/{len(candidates)} | files_with_hits={stats['files_with_hits']} "
                    f"| full={stats['full_high_hits']} partial={stats['partial_hits']} "
                    f"| missing={stats['missing_locally']} errors={stats['errors']} | {speed} files/s"
                )

        payload = {
            "generated_at": datetime.utcnow().isoformat(),
            "dry_run": dry_run,
            "sources": sources,
            "stats": dict(stats),
            "cancellations": dict(sorted(cache.items())),
            "partial_examples": partial[:50],
            "missing_examples": missing[:50],
            "examples": examples,
        }

        missing_report = _write_report(MISSING_REPORT_FILE, missing, "missing")
        partial_report = _write_report(PARTIAL_REPORT_FILE, partial, "partial")
        _log(
            f"[text cancellations] Reports written | missing_unique={missing_report['unique_nregs']} "
            f"partial_unique={partial_report['unique_nregs']}"
        )

        if not dry_run:
            CACHE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            _log(f"[text cancellations] Cache written: {CACHE_FILE}")
        else:
            _log("[text cancellations] Dry-run: cache was not written")

        state.update({
            "running": False,
            "phase": "done",
            "completed_at": datetime.utcnow().isoformat(),
            "stats": dict(stats),
            "unique_cancelled": len(cache),
            "missing_report": {
                "path": str(MISSING_REPORT_FILE),
                "records": missing_report["total_records"],
                "unique": missing_report["unique_nregs"],
            },
            "partial_report": {
                "path": str(PARTIAL_REPORT_FILE),
                "records": partial_report["total_records"],
                "unique": partial_report["unique_nregs"],
            },
            "examples": examples,
            "cache_file": str(CACHE_FILE),
        })
        _save_state(state)

        _log(
            f"[text cancellations] Done | full_high={stats['full_high_hits']} "
            f"| unique_cancelled={len(cache)} | partial={stats['partial_hits']} "
            f"| missing={stats['missing_locally']} | errors={stats['errors']}"
        )
        return payload

    except Exception as exc:
        state.update({"running": False, "phase": "error", "error": str(exc)})
        _save_state(state)
        _log(f"[text cancellations] CRITICAL: {exc}", "error")
        raise


def _check_card(nreg: str) -> dict[str, Any]:
    url = f"https://data.rada.gov.ua/laws/card/{nreg}.json"
    try:
        res = requests.get(url, timeout=12)
        if res.status_code == 200:
            try:
                data = res.json()
            except Exception:
                return {"nreg": nreg, "status": "bad_json", "url": url}
            if "nazva" not in data:
                return {"nreg": nreg, "status": "not_found", "url": url}
            return {
                "nreg": nreg,
                "status": "found",
                "url": url,
                "title": data.get("nazva", ""),
                "doc_status": data.get("status"),
                "dokid": data.get("dokid"),
                "typ": data.get("typ"),
                "orgid": data.get("orgid", data.get("org", "")),
            }
        if res.status_code == 404:
            return {"nreg": nreg, "status": "not_found", "url": url}
        if res.status_code == 429:
            return {"nreg": nreg, "status": "rate_limit", "url": url}
        return {"nreg": nreg, "status": f"http_{res.status_code}", "url": url}
    except requests.exceptions.Timeout:
        return {"nreg": nreg, "status": "timeout", "url": url}
    except requests.exceptions.ConnectionError:
        return {"nreg": nreg, "status": "connection", "url": url}
    except Exception as exc:
        return {"nreg": nreg, "status": f"error:{type(exc).__name__}", "error": str(exc), "url": url}


def run_check_missing_opendata(
    log_callback=print,
    stop_event: threading.Event | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Check missing report nregs against Rada OpenData card API."""
    global _stop_event, _log_fn
    _stop_event = stop_event
    _log_fn = log_callback

    started = time.time()
    state: dict[str, Any] = {
        "running": True,
        "phase": "check_opendata",
        "started_at": datetime.utcnow().isoformat(),
        "stats": {},
    }
    _save_check_state(state)

    if not MISSING_REPORT_FILE.exists():
        msg = f"Missing report not found: {MISSING_REPORT_FILE}"
        _log(f"[missing opendata] {msg}", "error")
        state.update({"running": False, "phase": "error", "error": msg})
        _save_check_state(state)
        raise FileNotFoundError(msg)

    report = _read_json(MISSING_REPORT_FILE)
    counts = Counter(str(r.get("cancelled_nreg", "")) for r in report.get("records", []) if r.get("cancelled_nreg"))
    nregs = list(counts.keys())
    if limit and limit > 0:
        nregs = nregs[:limit]

    _log(f"[missing opendata] Start | unique={len(nregs)} | report_records={report.get('total_records', 0)}")
    results: list[dict[str, Any]] = []
    stats = Counter()
    log_every = max(20, len(nregs) // 50) if nregs else 20

    try:
        for idx, nreg in enumerate(nregs, start=1):
            if stop_event and stop_event.is_set():
                _log(f"[missing opendata] Stop requested at {idx}/{len(nregs)}", "warning")
                break

            item = _check_card(nreg)
            item["mentions"] = counts.get(nreg, 0)
            results.append(item)
            stats[item["status"]] += 1

            if item["status"] == "rate_limit":
                _log("[missing opendata] Rate limit, sleeping 30s", "warning")
                time.sleep(30)
            else:
                time.sleep(0.05)

            if idx % log_every == 0 or idx == len(nregs):
                elapsed = time.time() - started
                speed = round(idx / elapsed, 1) if elapsed > 0 else 0
                _log(
                    f"[missing opendata] {idx}/{len(nregs)} | found={stats['found']} "
                    f"not_found={stats['not_found']} retry={stats['rate_limit'] + stats['timeout'] + stats['connection']} "
                    f"other={sum(v for k, v in stats.items() if k not in {'found','not_found','rate_limit','timeout','connection'})} "
                    f"| {speed} nreg/s"
                )

        found = [r for r in results if r.get("status") == "found"]
        payload = {
            "generated_at": datetime.utcnow().isoformat(),
            "source_report": str(MISSING_REPORT_FILE),
            "stats": dict(stats),
            "total_checked": len(results),
            "found_count": len(found),
            "scrape_candidates": found,
            "results": results,
        }
        OPENDATA_REPORT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        state.update({
            "running": False,
            "phase": "done",
            "completed_at": datetime.utcnow().isoformat(),
            "stats": dict(stats),
            "total_checked": len(results),
            "found_count": len(found),
            "report_file": str(OPENDATA_REPORT_FILE),
        })
        _save_check_state(state)
        _log(
            f"[missing opendata] Done | checked={len(results)} found={len(found)} "
            f"not_found={stats['not_found']} errors={sum(v for k, v in stats.items() if k not in {'found','not_found'})}"
        )
        return payload
    except Exception as exc:
        state.update({"running": False, "phase": "error", "error": str(exc)})
        _save_check_state(state)
        _log(f"[missing opendata] CRITICAL: {exc}", "error")
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract text-based cancellation facts")
    parser.add_argument("--source", choices=["rada", "kmu", "all"], default="all")
    parser.add_argument("--apply", action="store_true", help="Write text_cancellations_cache.json")
    parser.add_argument("--check-missing", action="store_true", help="Check missing report nregs in OpenData")
    parser.add_argument("--limit", type=int, default=None, help="Limit OpenData missing check")
    args = parser.parse_args()
    if args.check_missing:
        run_check_missing_opendata(limit=args.limit)
    else:
        srcs = SOURCES if args.source == "all" else [args.source]
        run_extract(sources=srcs, dry_run=not args.apply)
