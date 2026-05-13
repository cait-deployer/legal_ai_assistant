# URAI Legal Assistant

URAI is a Ukrainian-law RAG chatbot built with Next.js, Supabase, FastAPI,
Qdrant and Vertex AI/Gemini. Users ask legal questions in Ukrainian or Russian;
the backend retrieves relevant legal sources from V2 Qdrant collections and
Gemini generates a cited answer.

## Current Production Shape

- Frontend: Next.js App Router in `app/`.
- API routes: Next.js Route Handlers in `app/api/`.
- Backend: FastAPI in `backend/server.py`, with route/helper modules in
  `backend/*_routes.py`, `backend/schemas.py` and `backend/retrieval_helpers.py`.
- Vector storage: Qdrant V2 collections from `backend/qdrant_storage.py`.
- User/chat storage: Supabase tables for profiles, chats, messages, analytics,
  feedback and plans.
- Embeddings: `gemini-embedding-001`, 3072 dimensions.
- Main answer model: configured by `app_settings.ai_model`.

## Important Runtime Files

- `app/chat/page.tsx` - chat UI, SSE stream consumption, stop-generation UX,
  chat switching, message persistence and one-time beta tester welcome UX.
- `app/api/ask/stream/route.ts` - authenticated streaming proxy to FastAPI,
  plan/source gating and response preference gating.
- `app/api/ask/route.ts` - non-streaming ask proxy with the same plan logic.
- `backend/server.py` - FastAPI app entrypoint, `_ask_pipeline()`, chat
  endpoints, long-running sync/reindex workers and shared operation state.
- `backend/retrieval_helpers.py` - query-planner normalization, retrieval
  scoring, answerability, citation and answer-completion helpers.
- `backend/source_reranking.py` - generic source-role ranking signal for legal
  authority/directness. It does not hardcode answers to specific questions.
- `backend/schemas.py` - Pydantic request models shared by backend routes.
- `backend/generation_routes.py` - utility LLM routes for history summaries,
  chat names and user prompt generation.
- `backend/eval_routes.py` - admin retrieval evaluation routes.
- `backend/admin_operation_routes.py` - admin pipeline, enrichment, text-cache,
  Qdrant metadata and meta-list HTTP routes.
- `backend/qdrant_storage.py` - Qdrant collection definitions and search helpers.
- `backend/reindex_v2.py` - reads raw law files, chunks, embeds and uploads to
  V2 Qdrant.
- `backend/scrape_all_v2.py` - scrapes main sources to `/root/laws_raw`.
- `backend/scrape_mod_v2.py` - scrapes Ministry of Defense documents.
- `backend/scrape_zir_v2.py` - scrapes ZIR/DPS Q&A.
- `backend/enrich_opendata_meta.py` - enriches Rada/KMU metadata from OpenData.
- `backend/update_qdrant_meta.py` - patches enriched metadata into Qdrant.

## Knowledge Sources

Production retrieval uses V2 Qdrant collections:

- Rada: `rada_finance_v2`, `rada_state_v2`, `rada_personnel_v2`,
  `rada_court_v2`, `rada_intl_v2`, `rada_labor_v2`, `rada_civil_v2`,
  `rada_criminal_v2`, `rada_admin_v2`, `rada_housing_v2`, `rada_land_v2`,
  `rada_industry_v2`, `rada_other_v2`.
- Other: `laws_supreme_v2`, `laws_wiki_v2`, `laws_ccu_v2`,
  `laws_positions_v2`, `laws_kmu_v2`, `laws_mod_v2`, `laws_zir_v2`.

`laws_mod_v2` is the Ministry of Defense source. It contains MOD normative and
reference documents scraped from `mod.gov.ua`, mainly orders, procedures,
methodical and reference materials in the personnel, financial and property
areas.

`laws_zir_v2` is the tax Q&A source from ZIR/DPS. It is useful for official tax
clarifications, but it should not replace primary law when a primary norm is
available.

## Ask Pipeline Summary

1. Next.js route authenticates the user and builds `max_docs`, `filter_sources`,
   response features and response preferences from plan data.
2. Backend validates the question.
3. Russian-looking questions may be translated to Ukrainian for search.
4. Follow-up questions are resolved using recent chat history.
5. A compact history evidence summary can be carried into follow-up retrieval.
6. Query embedding and the AI query planner run in parallel.
7. The planner creates search terms, title hints, target collections and
   evidence subquestions. Planner output is only a retrieval plan, never legal
   truth.
8. Vector, title and keyword searches collect candidates from allowed V2
   collections.
9. The backend applies source scoring, document expansion, article-window
   protection, aspect/evidence coverage, answerability reranking and
   source-role reranking.
10. Final context is squeezed to the strongest chunks and capped by response
    preference and `context_char_cap`.
11. Gemini streams the answer with citations. A hidden `URAI_DONE` marker and
    continuation logic help avoid cut-off answers.
12. The frontend saves the final assistant message, citations and analytics.

## Feedback UX

URAI has two feedback paths:

- Inline message feedback under assistant answers (`MessageFeedback`). Beta
  testers are expected to use these like/dislike controls after answers.
- Generic app review (`ReviewModal`) for non-beta users when the review trigger
  says it should be shown.

Beta testers are treated as effective Pro users. In chat they receive only a
one-time `BetaTesterWelcomeModal` after the first saved assistant answer in the
browser. The modal explains beta status and asks for inline feedback; it is not
shown after every answer.

## Local Development

```powershell
npm run dev
```

The frontend normally runs on `http://localhost:3000`. The backend is a separate
FastAPI service and must be running for chat answers.

## Deployment Notes

On the production server:

```bash
cd /home/devops/app
git pull
systemctl restart backend.service
npm run build
systemctl restart frontend.service
```

Use only the relevant restart:

- Python/backend changes: restart `backend.service`.
- Next.js changes: build and restart `frontend.service`.
- Both: do both.

Never commit `.env` or service account JSON. Never run two V2 reindex jobs at
the same time. Never delete reindex/scrape state files unless the user
explicitly wants to reset a job.

## Documentation Map

- `CHATBOT_FLOW.md` - current end-to-end chat flow.
- `URAI_ARCHITECTURE.md` - architecture, backend module layout, sources,
  storage, admin pages.
- `RAG_QUERY_PLANNER.md` - planner JSON contract and retrieval usage.
- `LEGAL_CONSTANTS_PLAN.md` - proposed design for a future legal-constants
  layer. It is not current runtime behavior until explicitly implemented.
- `V2_БАЗА_ПОЯСНЕННЯ.md` - human explanation of the V2 knowledge base.
- `GEMINI_PROMPT.md` - production answer-prompt guidance.
- `RAG2_NEXT_CHAT_PROMPT.md` - handoff prompt for future RAG quality work.
- `CLAUDE.md` - compact working guide for coding agents.
- `AGENTS.md` - local Next.js warning.
