# URAI Working Guide For Coding Agents

> Updated: May 2026. Keep this file short and accurate. Detailed flow lives in
> `CHATBOT_FLOW.md`, `URAI_ARCHITECTURE.md` and `RAG_QUERY_PLANNER.md`.

## Project

URAI is a Ukrainian-law legal assistant:

- Frontend: Next.js App Router in `app/`.
- Backend: FastAPI in `backend/server.py`.
- Storage: Supabase and Qdrant.
- Retrieval: V2 Qdrant collections, `gemini-embedding-001`, 3072 dimensions.
- Generation: Gemini/Vertex AI, model selected from Supabase `app_settings`.

## Always Remember

- The production chat uses V2 collections, not the old V1 collections.
- `backend/server.py` is the main retrieval and generation pipeline.
- `backend/qdrant_storage.py` defines current V2 collection names.
- `context_summary` exists but the chat page currently sends `null` to ask
  generation.
- If editing Next.js, read the relevant docs in `node_modules/next/dist/docs/`.
- Do not commit `.env` or service account files.

## Current RAG Concepts

- Query planner returns JSON search hints, including `evidence_subquestions`.
- Planner output is only a retrieval plan, never a legal source.
- Search is broad; final context is squeezed.
- Deterministic answerability reranking is the default.
- Gemini reranker is optional behind `llm_reranker_enabled`.
- Follow-up questions can carry compact cited history evidence.
- Direct article/norm questions can trigger article-window protection.
- MOD and ZIR are first-class V2 sources, but they have source roles:
  - MOD: Ministry of Defense documents from `mod.gov.ua`.
  - ZIR: official tax Q&A from DPS.

## Important Files

- `app/chat/page.tsx` - chat UI and SSE stream handling.
- `app/api/ask/stream/route.ts` - streaming proxy and plan/source gating.
- `app/api/ask/route.ts` - non-streaming ask proxy.
- `backend/server.py` - RAG pipeline and admin endpoints.
- `backend/qdrant_storage.py` - Qdrant collection/search helpers.
- `backend/reindex_v2.py` - V2 reindex.
- `backend/scrape_all_v2.py`, `backend/scrape_mod_v2.py`,
  `backend/scrape_zir_v2.py` - scrapers.
- `backend/enrich_opendata_meta.py`, `backend/update_qdrant_meta.py` -
  metadata enrichment and Qdrant patching.

## Verification

For backend-only changes:

```powershell
python -m py_compile backend\server.py
git diff --check
```

For frontend changes, try TypeScript/lint when the local environment supports
it. In this workspace Windows/WSL setup may block `npm` commands; report that
clearly instead of hiding it.

## Do Not

- Do not call `vertexai.init()` per request.
- Do not run two V2 reindex jobs at once.
- Do not hardcode answers for individual legal questions.
- Do not globally boost one collection without eval evidence.
- Do not remove wiki/ZIR/MOD just because one answer was poor.
- Do not use specific-company/auction/procurement documents as general rules.
- Do not use V1 collection names in new production chat code.
- Do not ignore `upload_to_qdrant()` return values.
- Do not store zero vectors.

## When Improving RAG

Prefer small changes that improve source selection generally:

- better directness/coverage scoring;
- better title/article matching;
- better named-entity specificity filtering;
- better follow-up evidence handling;
- eval-case driven tuning.

Avoid one-question patches unless they generalize cleanly.
