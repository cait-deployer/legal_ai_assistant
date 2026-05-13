# URAI Architecture

> Updated: May 2026. Source of truth: `app/chat/page.tsx`,
> `app/api/ask/stream/route.ts`, `app/api/ask/route.ts`, `backend/server.py`,
> `backend/retrieval_helpers.py`, `backend/qdrant_storage.py`.

This document describes the current production architecture, not the old V1
prototype.

## System Layers

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Frontend | Next.js App Router, React | Chat UI, admin panel, settings, auth UX, SSE display |
| API routes | Next.js Route Handlers | Supabase auth, plan gating, source gating, backend proxy |
| Backend | FastAPI Python | Retrieval, query planning, Qdrant, Gemini, sync/reindex/admin routes |
| Storage | Supabase + Qdrant | Users/chats/messages/analytics/settings + vector knowledge base |

## Backend Module Layout

`backend/server.py` remains the FastAPI application entrypoint and keeps the
main chat orchestration in `_ask_pipeline()`. The file also still owns the
long-running sync/reindex worker functions and shared in-memory operational
state.

Supporting modules now hold code that used to live directly in `server.py`:

| File | Responsibility |
| --- | --- |
| `backend/schemas.py` | Pydantic request bodies shared by FastAPI routes. |
| `backend/retrieval_helpers.py` | Query planner normalization, retrieval scoring, answerability helpers, citation filtering and answer-completion helpers used by `_ask_pipeline()`, `/ask` and `/ask_stream`. |
| `backend/generation_routes.py` | Utility LLM routes: `/summarize_history`, `/generate-name`, `/generate-user-prompt`. |
| `backend/eval_routes.py` | Admin retrieval eval runner routes under `/admin/eval/*`. It calls `_ask_pipeline()` for production-like retrieval evaluation. |
| `backend/admin_operation_routes.py` | Admin operation HTTP routes for pipeline, enrichment, text-cancellation, Qdrant metadata patching and `/admin/meta/list`. Worker functions remain in `server.py`. |

When changing production chat behavior, start with `_ask_pipeline()` in
`server.py` and helper functions in `retrieval_helpers.py`. When changing
admin HTTP wiring, check the route-registration modules first.

## Current Chat Flow

1. User sends a message in `app/chat/page.tsx`.
2. If needed, frontend creates a chat row.
3. The user message is saved to Supabase.
4. Frontend sends the last 6 messages as `history`. `context_summary` is still
   sent as `null` from the chat page.
5. `app/api/ask/stream/route.ts` authenticates the user and reads profile, plan
   and feature data.
6. The route builds `max_docs`, `filter_sources`, `response_features`,
   `response_length_pref` and `response_lang_style`.
7. The route proxies the request to FastAPI `/ask_stream`.
8. Backend retrieves context and streams answer tokens.
9. Frontend displays tokens, then finalizes on the `citations` event.
10. Assistant message, citations, analytics and usage are saved.
11. Background title/summary tasks may run after the response.

The chat input supports stop-generation UX: during generation the send icon is
replaced with a stop icon; clicking it aborts the current request and restores
the last question into the input for editing.

## API Request Contract

Backend `AskRequest` accepts:

```json
{
  "question": "string",
  "max_docs": 12,
  "filter_sources": ["rada", "kmu", "wiki", "mod", "zir"],
  "response_features": ["response_detailed", "response_steps"],
  "user_profile": {
    "role": "string",
    "sub_role": ["string"],
    "segment": ["string"]
  },
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "context_summary": null,
  "ai_personal_prompt": null,
  "response_length_pref": "standard",
  "response_lang_style": "legal"
}
```

Both `/api/ask/stream` and `/api/ask` use the same plan/profile preparation.
The streaming route additionally has the free-account fingerprint guard.

## Plan And Source Gating

Plan data comes from Supabase:

- `subscription_plans.max_docs_retrieved` controls retrieval depth.
- `plan_features` controls enabled sources and response features.
- Beta users are treated as effective Pro.
- `full` answers require Pro/Beta.
- `detailed` answers require paid/Beta.

Source feature mapping:

| Feature | Backend source | Qdrant collections |
| --- | --- | --- |
| `source_rada` | `rada` | all `rada_*_v2` |
| `source_legalaid` | `wiki` | `laws_wiki_v2` |
| `source_supreme` | `supreme` | `laws_supreme_v2` |
| `source_ccu` | `ccu` | `laws_ccu_v2` |
| `source_lpd` | `lpd` | `laws_positions_v2` |
| `source_kmu` | `kmu` | `laws_kmu_v2` |
| `source_mod` | `mod` | `laws_mod_v2` |
| `source_zir` | `zir` | `laws_zir_v2` |

When at least one source feature exists, the API route adds `kmu`, `mod` and
`zir` to the allowed source list so important governmental and practical tax/MOD
sources are not hidden by narrow plan data.

## V2 Knowledge Base

Production retrieval uses V2 collections only:

| Family | Collections |
| --- | --- |
| Rada | `rada_finance_v2`, `rada_state_v2`, `rada_personnel_v2`, `rada_court_v2`, `rada_intl_v2`, `rada_labor_v2`, `rada_civil_v2`, `rada_criminal_v2`, `rada_admin_v2`, `rada_housing_v2`, `rada_land_v2`, `rada_industry_v2`, `rada_other_v2` |
| Other | `laws_supreme_v2`, `laws_wiki_v2`, `laws_ccu_v2`, `laws_positions_v2`, `laws_kmu_v2`, `laws_mod_v2`, `laws_zir_v2` |

V2 uses `gemini-embedding-001`, 3072-dimensional vectors and cosine distance.
Raw source text is stored under `/root/laws_raw/{source}/`.

## Source Roles

- Rada: primary laws, codes and resolutions.
- KMU: Cabinet of Ministers resolutions, procedures and orders.
- MOD: Ministry of Defense normative/reference materials from `mod.gov.ua`,
  mostly personnel, financial and property-related orders/procedures.
- ZIR: official tax Q&A from DPS; useful for tax practice, not a replacement for
  primary law when primary law is available.
- Wiki: explanatory background from LegalAid Wiki.
- Supreme/positions/CCU: court and constitutional interpretation; important, but
  should not crowd out direct normative sources for simple norm questions.

## Backend Retrieval Pipeline

The current `_ask_pipeline()` does this:

1. Validate question.
2. Initialize Vertex AI if needed.
3. Translate Russian-looking questions for Ukrainian search.
4. Resolve follow-up questions using recent chat history.
5. Carry compact cited history evidence into follow-up retrieval when useful.
6. Run query embedding and the AI query planner in parallel.
7. Build allowed V2 collections from plan sources, planner hints and semantic
   collection hints.
8. Search original and planned queries.
9. Merge candidates by `(law_id, chunk_index)`.
10. Apply low-confidence widening when needed.
11. Apply source/document scoring and avoid-topic penalties.
12. Deduplicate and diversify.
13. Expand promising documents with sibling chunks.
14. Run keyword and title MatchText searches.
15. Run dynamic primary-act discovery.
16. Protect aspect and evidence-subquestion coverage candidates.
17. Run deterministic answerability reranking.
18. Optionally run Gemini reranker only when `llm_reranker_enabled=true`.
19. Inject contiguous article windows for direct article/norm questions.
20. Filter expired/cancelled documents.
21. Squeeze context to the strongest chunks.
22. Generate the answer and classification.
23. Use `URAI_DONE` and continuation logic to reduce truncated answers.

The old centroid/router-only flow is not the current production mental model.

## Context Building

Final context is intentionally narrower than search:

- Search can be broad.
- Context sent to Gemini is squeezed by answerability, source authority, direct
  coverage, recency and text quality.

Default context targets by response preference:

| Preference | Target chunks |
| --- | ---: |
| `short` | 6 |
| `standard` | 8 |
| `detailed` | 10 |
| `full` | 12 |

Overall character cap is `context_char_cap`, default 30000.

## Admin Pages

- `/admin/sync` - source overview and status.
- `/admin/v2` - V2 scraper, reindex, analytics, disk and sources.
- `/admin/meta` - metadata enrichment and Qdrant payload patching.
- `/admin/ai-settings` - AI settings and prompts.
- `/admin/users` - user management.
- `/admin/analytics` - query analytics/eval workflow.
- `/admin/feedback` - feedback and app reviews.
- Legacy V1 pages may still exist, but new work should not infer production chat
  behavior from V1 labels.

## Operational Rules

- Do not run two V2 reindex jobs at once.
- Reindex V2 safe order is: embed first, then delete old chunks, then upload new
  chunks.
- `upload_to_qdrant()` returns `bool`; always check it.
- Do not store zero vectors.
- Do not call `vertexai.init()` per request.
- Do not globally boost one source without eval evidence.
- Do not remove wiki/ZIR/MOD; treat them by source role and directness.
- Every admin-visible backend capability should have a matching admin UI.

## Known Gaps

- `context_summary` is generated/stored but the chat page currently sends `null`
  for generation.
- `tokens_used` in SSE metadata is not a reliable real token count.
- Some legacy V1 scripts and admin labels remain in the repo.
- Quality work should be measured with approved/gold eval cases, not just visual
  inspection of one answer.
