"""Admin operation routes for pipeline, enrichment and metadata screens."""

import json
import uuid
from pathlib import Path

from fastapi import Body, HTTPException


def register_admin_operation_routes(app, deps: dict) -> None:
    _start_sync = deps["_start_sync"]
    _do_pipeline = deps["_do_pipeline"]
    _do_enrich_opendata = deps["_do_enrich_opendata"]
    _do_extract_text_cancellations = deps["_do_extract_text_cancellations"]
    _do_check_text_missing = deps["_do_check_text_missing"]
    _do_scrape_text_missing_found = deps["_do_scrape_text_missing_found"]
    _do_apply_text_cancellations = deps["_do_apply_text_cancellations"]
    _do_update_qdrant_meta = deps["_do_update_qdrant_meta"]
    _lock = deps["_lock"]
    _sync = deps["_sync"]
    _pipeline_stop = deps["_pipeline_stop"]
    _v2_scrape_stop = deps["_v2_scrape_stop"]
    _enrich_stop = deps["_enrich_stop"]
    _text_cancel_stop = deps["_text_cancel_stop"]
    _text_missing_check_stop = deps["_text_missing_check_stop"]
    _text_missing_scrape_stop = deps["_text_missing_scrape_stop"]
    _apply_text_cancel_stop = deps["_apply_text_cancel_stop"]
    _qdrant_meta_stop = deps["_qdrant_meta_stop"]
    _PIPELINE_LAST_RUN_FILE = deps["_PIPELINE_LAST_RUN_FILE"]
    _PIPELINE_STEP_NAMES = deps["_PIPELINE_STEP_NAMES"]

    @app.post("/admin/pipeline/trigger")
    async def pipeline_trigger():
        session_id = str(uuid.uuid4())
        try:
            _start_sync("pipeline", _do_pipeline, session_id)
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id}


    @app.post("/admin/pipeline/stop")
    async def pipeline_stop_route():
        with _lock:
            if not _sync["pipeline"]["running"]:
                raise HTTPException(400, "Пайплайн не виконується")
            _pipeline_stop.set()
            # Signal all sub-process stop events.
            for _evt in _v2_scrape_stop.values():
                _evt.set()
            _enrich_stop.set()
            _text_cancel_stop.set()
            _apply_text_cancel_stop.set()
            _qdrant_meta_stop.set()
            _sync["pipeline"]["pause_requested"] = True
        return {"ok": True}


    @app.get("/admin/pipeline/status")
    async def pipeline_status():
        with _lock:
            running   = _sync["pipeline"]["running"]
            pause_req = _sync["pipeline"]["pause_requested"]
            logs      = list(_sync["pipeline"]["live_logs"])
        last_run = None
        if _PIPELINE_LAST_RUN_FILE.exists():
            try:
                last_run = json.loads(_PIPELINE_LAST_RUN_FILE.read_text("utf-8")).get("ts")
            except Exception:
                pass
        return {
            "running":         running,
            "pause_requested": pause_req,
            "live_logs":       logs,
            "last_run":        last_run,
            "step_names":      _PIPELINE_STEP_NAMES,
        }


    @app.post("/admin/enrich/start")
    async def enrich_start(body: dict = Body(default={})):
        sources = body.get("sources") or ["rada", "kmu"]
        force   = bool(body.get("force", False))
        session_id = str(uuid.uuid4())
        try:
            _start_sync("enrich_opendata", _do_enrich_opendata, session_id,
                        sources=sources, force=force)
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id}


    @app.post("/admin/enrich/stop")
    async def enrich_stop_route():
        with _lock:
            if not _sync["enrich_opendata"]["running"]:
                raise HTTPException(400, "Збагачення не виконується")
            _enrich_stop.set()
            _sync["enrich_opendata"]["pause_requested"] = True
        return {"ok": True}


    @app.post("/admin/enrich/text/start")
    async def enrich_text_start(body: dict = Body(default={})):
        sources = body.get("sources") or ["rada", "kmu"]
        dry_run = bool(body.get("dry_run", True))
        session_id = str(uuid.uuid4())
        try:
            _start_sync(
                "extract_text_cancellations",
                _do_extract_text_cancellations,
                session_id,
                sources=sources,
                dry_run=dry_run,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id, "dry_run": dry_run}


    @app.post("/admin/enrich/text/stop")
    async def enrich_text_stop():
        with _lock:
            if not _sync["extract_text_cancellations"]["running"]:
                raise HTTPException(400, "Text cancellation extraction is not running")
            _text_cancel_stop.set()
            _sync["extract_text_cancellations"]["pause_requested"] = True
        return {"ok": True}


    @app.post("/admin/enrich/text/check-missing/start")
    async def enrich_text_check_missing_start(body: dict = Body(default={})):
        limit_raw = body.get("limit")
        limit = int(limit_raw) if limit_raw else None
        session_id = str(uuid.uuid4())
        try:
            _start_sync(
                "check_text_missing",
                _do_check_text_missing,
                session_id,
                limit=limit,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id, "limit": limit}


    @app.post("/admin/enrich/text/check-missing/stop")
    async def enrich_text_check_missing_stop():
        with _lock:
            if not _sync["check_text_missing"]["running"]:
                raise HTTPException(400, "Missing OpenData check is not running")
            _text_missing_check_stop.set()
            _sync["check_text_missing"]["pause_requested"] = True
        return {"ok": True}


    @app.post("/admin/enrich/text/scrape-found/start")
    async def enrich_text_scrape_found_start(body: dict = Body(default={})):
        limit_raw = body.get("limit")
        limit = int(limit_raw) if limit_raw else None
        force = bool(body.get("force", False))
        session_id = str(uuid.uuid4())
        try:
            _start_sync(
                "scrape_text_missing_found",
                _do_scrape_text_missing_found,
                session_id,
                limit=limit,
                force=force,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id, "limit": limit, "force": force}


    @app.post("/admin/enrich/text/scrape-found/stop")
    async def enrich_text_scrape_found_stop():
        with _lock:
            if not _sync["scrape_text_missing_found"]["running"]:
                raise HTTPException(400, "Scrape found missing is not running")
            _text_missing_scrape_stop.set()
            _sync["scrape_text_missing_found"]["pause_requested"] = True
        return {"ok": True}


    @app.post("/admin/enrich/text/apply-cache/start")
    async def enrich_text_apply_cache_start(body: dict = Body(default={})):
        sources = body.get("sources") or ["rada", "kmu"]
        session_id = str(uuid.uuid4())
        try:
            _start_sync(
                "apply_text_cancellations",
                _do_apply_text_cancellations,
                session_id,
                sources=sources,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id}


    @app.post("/admin/enrich/text/apply-cache/stop")
    async def enrich_text_apply_cache_stop():
        with _lock:
            if not _sync["apply_text_cancellations"]["running"]:
                raise HTTPException(400, "Apply text cache is not running")
            _apply_text_cancel_stop.set()
            _sync["apply_text_cancellations"]["pause_requested"] = True
        return {"ok": True}


    @app.get("/admin/enrich/text/report")
    async def enrich_text_report(
        kind: str = "missing",
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ):
        allowed = {
            "missing": "text_cancellations_missing_report.json",
            "partial": "text_cancellations_partial_report.json",
            "opendata": "text_cancellations_missing_opendata_report.json",
        }
        if kind not in allowed:
            raise HTTPException(400, f"kind must be one of {list(allowed)}")
        path = Path(__file__).parent / allowed[kind]
        if not path.exists():
            return {"kind": kind, "items": [], "total": 0, "summary": {}, "exists": False}
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            raise HTTPException(500, f"Cannot read report: {e}")

        records = report.get("records")
        if records is None:
            records = report.get("results") or report.get("scrape_candidates") or []
        from urllib.parse import unquote

        def decode_report_item(item):
            if not isinstance(item, dict):
                return item
            out = dict(item)
            for key in ("cancelled_nreg", "raw_cancelled_nreg", "nreg", "by"):
                if isinstance(out.get(key), str):
                    out[key] = unquote(out[key])
            return out

        records = [decode_report_item(item) for item in records]
        if status:
            records = [item for item in records if isinstance(item, dict) and item.get("status") == status]
        total = len(records)
        summary = {
            "generated_at": report.get("generated_at"),
            "kind": report.get("kind", kind),
            "total_records": report.get("total_records", total),
            "unique_nregs": report.get("unique_nregs"),
            "stats": report.get("stats", {}),
            "found_count": report.get("found_count"),
            "top": report.get("top", [])[:20],
        }
        return {
            "kind": kind,
            "exists": True,
            "summary": summary,
            "items": records[offset: offset + limit],
            "total": total,
            "offset": offset,
            "limit": limit,
        }


    @app.get("/admin/enrich/status")
    async def enrich_status():
        with _lock:
            s = dict(_sync["enrich_opendata"])
            logs = list(s.get("live_logs", []))
            qdm = dict(_sync["update_qdrant_meta"])
            qdm_logs = list(qdm.get("live_logs", []))
            text_cancel = dict(_sync["extract_text_cancellations"])
            text_cancel_logs = list(text_cancel.get("live_logs", []))
            text_missing = dict(_sync["check_text_missing"])
            text_missing_logs = list(text_missing.get("live_logs", []))
            text_scrape = dict(_sync["scrape_text_missing_found"])
            text_scrape_logs = list(text_scrape.get("live_logs", []))
            text_apply = dict(_sync["apply_text_cancellations"])
            text_apply_logs = list(text_apply.get("live_logs", []))

        state_file = Path(__file__).parent / "enrich_opendata_state.json"
        state = {}
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        qdrant_state_file = Path(__file__).parent / "update_qdrant_meta_state.json"
        qdrant_state = {}
        if qdrant_state_file.exists():
            try:
                qdrant_state = json.loads(qdrant_state_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        text_state_file = Path(__file__).parent / "text_cancellations_state.json"
        text_state = {}
        if text_state_file.exists():
            try:
                text_state = json.loads(text_state_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        text_missing_state_file = Path(__file__).parent / "text_cancellations_missing_opendata_state.json"
        text_missing_state = {}
        if text_missing_state_file.exists():
            try:
                text_missing_state = json.loads(text_missing_state_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        text_scrape_state_file = Path(__file__).parent / "text_cancellations_scrape_found_state.json"
        text_scrape_state = {}
        if text_scrape_state_file.exists():
            try:
                text_scrape_state = json.loads(text_scrape_state_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        return {
            "enrich": {
                "running":         s.get("running", False),
                "pause_requested": s.get("pause_requested", False),
                "live_logs":       logs,
                "state":           state,
            },
            "qdrant_meta": {
                "running":         qdm.get("running", False),
                "pause_requested": qdm.get("pause_requested", False),
                "live_logs":       qdm_logs,
                "state":           qdrant_state,
            },
            "text_cancellations": {
                "running":         text_cancel.get("running", False),
                "pause_requested": text_cancel.get("pause_requested", False),
                "live_logs":       text_cancel_logs,
                "state":           text_state,
            },
            "text_missing_check": {
                "running":         text_missing.get("running", False),
                "pause_requested": text_missing.get("pause_requested", False),
                "live_logs":       text_missing_logs,
                "state":           text_missing_state,
            },
            "text_missing_scrape": {
                "running":         text_scrape.get("running", False),
                "pause_requested": text_scrape.get("pause_requested", False),
                "live_logs":       text_scrape_logs,
                "state":           text_scrape_state,
            },
            "text_apply_cache": {
                "running":         text_apply.get("running", False),
                "pause_requested": text_apply.get("pause_requested", False),
                "live_logs":       text_apply_logs,
                "state":           {},
            },
        }


    @app.post("/admin/enrich/qdrant/apply")
    async def enrich_qdrant_apply(body: dict = Body(default={})):
        sources = body.get("sources") or ["rada", "kmu"]
        session_id = str(uuid.uuid4())
        try:
            _start_sync("update_qdrant_meta", _do_update_qdrant_meta, session_id,
                        sources=sources)
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True, "session_id": session_id}


    @app.post("/admin/enrich/qdrant/stop")
    async def enrich_qdrant_stop():
        with _lock:
            if not _sync["update_qdrant_meta"]["running"]:
                raise HTTPException(400, "Патч Qdrant не виконується")
            _qdrant_meta_stop.set()
            _sync["update_qdrant_meta"]["pause_requested"] = True
        return {"ok": True}


    @app.get("/admin/meta/list")
    async def meta_list(
        source: str = "rada",
        dead: str | None = None,
        doc_type: str | None = None,
        theme: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ):
        """Повертає список збагачених meta.json для перегляду в адмін панелі."""
        raw_base = Path("/root/laws_raw") / source
        if not raw_base.exists():
            return {"items": [], "total": 0, "source": source}

        items = []
        for meta_path in sorted(raw_base.glob("*.meta.json")):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                continue

            if "rada_enriched_at" not in meta:
                continue

            # Filters
            if dead == "true" and not meta.get("rada_is_dead"):
                continue
            if dead == "false" and meta.get("rada_is_dead"):
                continue
            if doc_type and meta.get("rada_doc_type") != doc_type:
                continue
            if theme and theme not in (meta.get("rada_theme") or ""):
                continue
            if q:
                q_lower = q.lower()
                title = (meta.get("rada_title") or "").lower()
                nreg  = (meta.get("rada_nreg")  or "").lower()
                if q_lower not in title and q_lower not in nreg:
                    continue

            items.append({
                "nreg":          meta.get("rada_nreg", meta_path.name.replace(".meta.json", "")),
                "title":         meta.get("rada_title", ""),
                "doc_type":      meta.get("rada_doc_type", ""),
                "status":        meta.get("rada_status", 0),
                "status_name":   meta.get("rada_status_name", ""),
                "is_dead":       meta.get("rada_is_dead", False),
                "dead_by_status":meta.get("rada_is_dead_by_status", False),
                "dead_by_link":  meta.get("rada_is_dead_by_link", False),
                "dead_by_text":  meta.get("rada_is_dead_by_text", False),
                "no_text":       meta.get("rada_no_text", False),
                "adopted_date":  meta.get("rada_adopted_date", ""),
                "last_edition":  meta.get("rada_last_edition", ""),
                "dead_since":    meta.get("rada_dead_since", ""),
                "replaced_by":   meta.get("rada_replaced_by", []),
                "cancelled_by":  meta.get("rada_cancelled_by", []),
                "cancelled_by_text": meta.get("rada_cancelled_by_text", []),
                "theme":         meta.get("rada_theme", ""),
                "classifiers":   meta.get("rada_classifiers", []),
                "org":           meta.get("rada_org", ""),
                "editions_cnt":  meta.get("rada_editions_cnt", 0),
                "url":           meta.get("rada_url", ""),
                "enriched_at":   meta.get("rada_enriched_at", ""),
            })

        total = len(items)
        return {
            "items":  items[offset: offset + limit],
            "total":  total,
            "source": source,
        }
