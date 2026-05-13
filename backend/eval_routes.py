"""Admin eval runner routes for retrieval quality checks."""

import re
import threading
import time
import uuid

from fastapi import HTTPException

from schemas import AskRequest, EvalRunBody


def register_eval_routes(app, ask_pipeline, logger) -> None:
    _eval_state: dict = {
        "running": False,
        "session_id": None,
        "started_at": None,
        "logs": [],
        "report": None,
        "error": None,
    }
    _eval_lock = threading.Lock()


    def _eval_result_row(r: dict) -> dict:
        meta = r.get("out_metadata") or {}
        ans = r.get("_answerability") or {}
        return {
            "law_id": meta.get("law_id", ""),
            "title": (meta.get("source") or meta.get("title") or "")[:240],
            "collection": r.get("_collection", ""),
            "score": round(float(r.get("similarity", 0.0) or 0.0), 4),
            "answerability": round(float(ans.get("score", 0.0) or 0.0), 4) if ans else None,
            "coverage": round(float(ans.get("coverage", 0.0) or 0.0), 3) if ans else None,
        }


    async def _eval_vector_retrieve(question: str, top_n: int = 20) -> list[dict]:
        """Fallback: embed question and search all V2 collections directly."""
        import asyncio as _asyncio
        import embed_v2 as _embed_v2
        from qdrant_storage import get_client, ALL_V2_COLLECTIONS

        vec = await _asyncio.to_thread(_embed_v2.embed_query, question)
        client = get_client()

        all_results: list[dict] = []
        for col in ALL_V2_COLLECTIONS:
            try:
                hits = await _asyncio.to_thread(
                    client.search, col, vec, limit=8, with_payload=True
                )
                for h in hits:
                    payload = h.payload or {}
                    all_results.append({
                        "law_id": payload.get("law_id", ""),
                        "title": (payload.get("source") or payload.get("title") or "")[:200],
                        "collection": col,
                        "score": round(float(h.score), 4),
                    })
            except Exception:
                pass

        all_results.sort(key=lambda x: x["score"], reverse=True)
        seen: set[str] = set()
        deduped: list[dict] = []
        for r in all_results:
            lid = r["law_id"]
            key = lid if lid else f"__noid_{r['title'][:40]}"
            if key not in seen:
                seen.add(key)
                deduped.append(r)
            if len(deduped) >= top_n:
                break
        return deduped


    async def _eval_retrieve(question: str, top_n: int = 20) -> list[dict]:
        """
        Run the same retrieval/rerank/context selection pipeline as the chat,
        but stop before answer generation. This makes eval results reflect the
        real RAG path: rewrite, routing, keyword/title boosts, answerability
        rerank, and context squeeze.
        """
        body = AskRequest(
            question=question,
            max_docs=max(top_n, 20),
            filter_sources=None,
            response_features=["response_detailed", "response_vs_position"],
            response_length_pref="full",
            response_lang_style="legal",
        )
        try:
            pipe = await ask_pipeline(body)
            if pipe.get("early_answer"):
                return []
            return [_eval_result_row(r) for r in (pipe.get("results") or [])][:top_n]
        except Exception as exc:
            logger.warning("EVAL PIPELINE fallback to vector search: %s", exc)
            return await _eval_vector_retrieve(question, top_n=top_n)


    def _eval_norm(text: str | None) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^\wА-Яа-яІіЇїЄєҐґ]+", " ", (text or "").lower())).strip()


    def _eval_source_matches_result(src: dict, result: dict) -> bool:
        src_law_id = (src.get("law_id") or "").strip()
        src_collection = (src.get("collection") or src.get("db_collection") or "").strip()
        res_law_id = (result.get("law_id") or "").strip()
        res_collection = (result.get("collection") or "").strip()

        if src_collection and res_collection and src_collection != res_collection:
            return False
        if src_law_id and res_law_id:
            return src_law_id == res_law_id

        src_title = _eval_norm(src.get("title") or src.get("db_title"))
        res_title = _eval_norm(result.get("title"))
        if not src_title or not res_title:
            return False
        return len(src_title) >= 16 and (src_title in res_title or res_title in src_title)


    def _check_sources(results: list[dict], sources: list[dict], top_k: int) -> list[dict]:
        checked = []
        for src in sources:
            rank = next((i + 1 for i, r in enumerate(results) if _eval_source_matches_result(src, r)), None)
            checked.append({
                **src,
                "found_in_top": rank is not None and rank <= top_k,
                "rank": rank,
            })
        return checked


    def _eval_worker(cases: list[dict], session_id: str):
        import asyncio as _asyncio

        loop = _asyncio.new_event_loop()
        _asyncio.set_event_loop(loop)

        total = len(cases)
        hit5 = hit10 = bad5 = missed = with_expected = 0

        try:
            for i, case in enumerate(cases):
                with _eval_lock:
                    if not _eval_state["running"]:
                        break

                question = (case.get("question") or "").strip()
                case_id = case.get("id", f"case_{i}")
                expected = case.get("expected_sources") or []
                bad = case.get("bad_sources") or []
                is_gold = case.get("is_gold", False)

                entry: dict = {
                    "index": i + 1,
                    "total": total,
                    "case_id": case_id,
                    "is_gold": is_gold,
                    "question": question[:200],
                    "status": "running",
                    "hit5": None,
                    "hit10": None,
                    "bad5": None,
                    "expected_checked": [],
                    "bad_checked": [],
                    "top5": [],
                    "error": None,
                }
                with _eval_lock:
                    _eval_state["logs"].append(entry)

                try:
                    results = loop.run_until_complete(_eval_retrieve(question, top_n=20))

                    exp_checked = _check_sources(results, expected, 5) if expected else []
                    exp_checked10 = _check_sources(results, expected, 10) if expected else []
                    bad_checked = _check_sources(results, bad, 5) if bad else []

                    any_hit5 = any(s["found_in_top"] for s in exp_checked) if expected else None
                    any_hit10 = any(s["found_in_top"] for s in exp_checked10) if expected else None
                    any_bad5 = any(s["found_in_top"] for s in bad_checked) if bad else None

                    if expected:
                        with_expected += 1
                        if any_hit5:
                            hit5 += 1
                        if any_hit10:
                            hit10 += 1
                        else:
                            missed += 1
                    if bad and any_bad5:
                        bad5 += 1

                    entry.update({
                        "status": "done",
                        "hit5": any_hit5,
                        "hit10": any_hit10,
                        "bad5": any_bad5,
                        "expected_checked": exp_checked,
                        "bad_checked": bad_checked,
                        "top5": results[:5],
                    })
                except Exception as exc:
                    entry.update({"status": "error", "error": str(exc)})

            report = {
                "total": total,
                "with_expected": with_expected,
                "hit5": hit5,
                "hit10": hit10,
                "missed": missed,
                "bad5_cases": bad5,
                "hit5_rate": round(hit5 / with_expected, 3) if with_expected else None,
                "hit10_rate": round(hit10 / with_expected, 3) if with_expected else None,
                "bad5_rate": round(bad5 / total, 3) if total else None,
                "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            with _eval_lock:
                _eval_state["running"] = False
                _eval_state["report"] = report

        except Exception as exc:
            with _eval_lock:
                _eval_state["running"] = False
                _eval_state["error"] = str(exc)
        finally:
            loop.close()


    @app.post("/admin/eval/run")
    async def eval_run(body: EvalRunBody):
        with _eval_lock:
            if _eval_state["running"]:
                raise HTTPException(409, "Eval runner is already running")
            if not body.cases:
                raise HTTPException(400, "No cases provided")
            sid = str(uuid.uuid4())[:8]
            _eval_state.update({
                "running": True,
                "session_id": sid,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "logs": [],
                "report": None,
                "error": None,
            })

        t = threading.Thread(target=_eval_worker, args=(body.cases, sid), daemon=True)
        t.start()
        return {"ok": True, "session_id": sid, "total": len(body.cases)}


    @app.post("/admin/eval/stop")
    async def eval_stop():
        with _eval_lock:
            _eval_state["running"] = False
        return {"ok": True}


    @app.get("/admin/eval/status")
    async def eval_status():
        with _eval_lock:
            return dict(_eval_state)


    @app.get("/admin/eval/check_ids")
    async def eval_check_ids(ids: str = ""):
        """Check which law_ids exist in any V2 Qdrant collection."""
        from qdrant_storage import ALL_V2_COLLECTIONS, get_client as _qclient
        from qdrant_client import models as _qmodels

        id_list = [i.strip() for i in ids.split(",") if i.strip()][:20]
        if not id_list:
            return {}

        client = _qclient()
        results: dict[str, dict] = {}

        def _check_one(law_id: str) -> dict:
            for col in ALL_V2_COLLECTIONS:
                try:
                    pts, _ = client.scroll(
                        collection_name=col,
                        scroll_filter=_qmodels.Filter(
                            must=[_qmodels.FieldCondition(
                                key="law_id",
                                match=_qmodels.MatchValue(value=law_id),
                            )]
                        ),
                        limit=1,
                        with_payload=["title", "law_id"],
                        with_vectors=False,
                    )
                    if pts:
                        title = pts[0].payload.get("title") if pts[0].payload else None
                        return {"found": True, "collection": col, "title": title}
                except Exception:
                    continue
            return {"found": False, "collection": None, "title": None}

        import asyncio as _asyncio
        for law_id in id_list:
            results[law_id] = await _asyncio.to_thread(_check_one, law_id)

        return results


    @app.post("/admin/eval/find_sources")
    async def eval_find_sources(body: dict):
        """
        For each source hint {law_id?, title?}: find the real document in Qdrant.
        Tries law_id exact match first, then vector search by title.
        Returns one result per input item (same order). Runs SEQUENTIALLY to avoid overwhelming Qdrant.
        """
        from qdrant_storage import ALL_V2_COLLECTIONS, get_client as _qclient, search_qdrant
        from qdrant_client import models as _qmodels
        import embed_v2 as _embed_v2
        import asyncio as _asyncio

        sources = (body.get("sources") or [])[:12]
        if not sources:
            return []

        client = _qclient()
        empty = {"found": False, "db_law_id": None, "db_title": None, "db_collection": None, "match_type": None}

        def _scroll_by_id(law_id: str) -> dict | None:
            """Synchronous scroll across all collections. Runs in a thread."""
            for col in ALL_V2_COLLECTIONS:
                try:
                    pts, _ = client.scroll(
                        collection_name=col,
                        scroll_filter=_qmodels.Filter(must=[_qmodels.FieldCondition(
                            key="law_id", match=_qmodels.MatchValue(value=law_id)
                        )]),
                        limit=1, with_payload=["source", "law_id"], with_vectors=False,
                    )
                    if pts:
                        p = pts[0].payload or {}
                        return {"found": True,
                                "db_law_id": p.get("law_id", law_id),
                                "db_title": p.get("source"),  # title stored as "source" in payload
                                "db_collection": col, "match_type": "law_id"}
                except Exception:
                    continue
            return None

        def _search_by_title(vec: list, threshold: float = 0.45) -> dict | None:
            """Synchronous vector search across all collections. Runs in a thread.
            search_qdrant returns {out_metadata: {...}, _collection: str, similarity: float}
            """
            try:
                hits = search_qdrant(vec, 3, ALL_V2_COLLECTIONS, threshold)
                if hits:
                    h = hits[0]
                    meta = h.get("out_metadata") or {}
                    return {"found": True,
                            "db_law_id": meta.get("law_id"),
                            "db_title": meta.get("source"),  # title stored as "source" in payload
                            "db_collection": h.get("_collection"),
                            "match_type": "title",
                            "score": round(float(h.get("similarity", 0)), 3)}
            except Exception:
                pass
            return None

        results = []
        for hint in sources:
            law_id = (hint.get("law_id") or "").strip()
            title = (hint.get("title") or "").strip()

            # 1. Try exact law_id match
            if law_id:
                try:
                    res = await _asyncio.to_thread(_scroll_by_id, law_id)
                    if res:
                        results.append(res)
                        continue
                except Exception:
                    pass

            # 2. Vector search by title
            if title:
                try:
                    vec = await _asyncio.to_thread(_embed_v2.embed_query, title[:300])
                    res = await _asyncio.to_thread(_search_by_title, vec)
                    if res:
                        results.append(res)
                        continue
                except Exception:
                    pass

            results.append(dict(empty))

        return results


    @app.get("/admin/eval/debug_scroll")
    async def eval_debug_scroll(law_id: str):
        """Debug: shows which V2 collections contain a given law_id (exact match)."""
        import asyncio as _asyncio
        try:
            from qdrant_storage import ALL_V2_COLLECTIONS, get_client as _qclient
            from qdrant_client import models as _qmodels

            client = _qclient()

            def _check():
                found_in = []
                errors = []
                for col in ALL_V2_COLLECTIONS:
                    try:
                        pts, _ = client.scroll(
                            collection_name=col,
                            scroll_filter=_qmodels.Filter(must=[_qmodels.FieldCondition(
                                key="law_id", match=_qmodels.MatchValue(value=law_id)
                            )]),
                            limit=3, with_payload=["source", "law_id"], with_vectors=False,
                        )
                        if pts:
                            p = pts[0].payload or {}
                            found_in.append({
                                "collection": col,
                                "db_law_id": p.get("law_id"),
                                "db_title": p.get("source"),
                                "chunks_found": len(pts),
                            })
                    except Exception as e:
                        errors.append(f"{col}: {type(e).__name__}: {e}")
                return {
                    "searched_for": law_id,
                    "found": len(found_in) > 0,
                    "found_in": found_in,
                    "collections_checked": len(ALL_V2_COLLECTIONS),
                    "errors": errors,
                }

            return await _asyncio.to_thread(_check)
        except Exception as e:
            return {"searched_for": law_id, "found": False, "error": f"{type(e).__name__}: {e}"}
