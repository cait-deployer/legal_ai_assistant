# URAI Chatbot Flow

> Updated: May 2026. This file is intentionally ASCII-only to avoid Windows console encoding corruption.

## Runtime Flow

```mermaid
flowchart TD
    A[User sends question] --> B[Chat UI creates chat if needed]
    B --> C[User message is saved]
    C --> D[Frontend sends last 6 messages as history]
    D --> E[/api/ask/stream reads auth, profile, plan, beta, features]
    E --> F[FastAPI /ask_stream]
    F --> G[Optional RU to UA translation]
    G --> H[Follow-up resolver for ambiguous short questions]
    H --> I[Parallel: query embedding + AI query planner]
    I --> J[Plan sources -> allowed V2 Qdrant collections]
    J --> K[Vector search: original and planner search query]
    K --> L[Merge semantic candidates]
    L --> M[Boost, dedup, diversity, document expansion]
    M --> N[Keyword MatchText + title boost + primary-act discovery]
    N --> O[Aspect coverage + deterministic answerability reranker]
    O --> P[Strict context squeeze + expired-document filter + context buckets]
    P --> Q[Gemini streamed answer + hidden completion marker + parallel classification]
    Q --> R[Backend strips marker and frontend displays clean tokens]
    R --> S[Assistant message, citations, analytics and usage are saved]
    S --> T[Every 2nd user turn starts background summary]
```

## Frontend Payload

`app/chat/page.tsx` currently:

- sends only the last 6 messages, roughly 3 conversation turns;
- sends `context_summary: null`;
- still generates and stores `chats.context_summary` in the background after every 2nd user turn;
- saves the assistant answer and analytics after streaming completes.

`context_summary` exists in the backend contract, but the chat UI does not inject it into generation yet.

## API Route

`app/api/ask/stream/route.ts`:

- verifies Supabase auth;
- reads `profiles` for tier, beta, onboarding profile, personal prompt, response preferences and usage fields;
- treats beta users as effective `pro`;
- reads `subscription_plans.max_docs_retrieved`;
- reads enabled `plan_features`;
- maps source features to backend source keys;
- adds `mod` and `zir` when at least one source feature is present;
- gates response preferences:
  - `full` requires Pro/Beta;
  - `detailed` requires paid/Beta;
- forwards `question`, `max_docs`, `filter_sources`, `response_features`, `user_profile`, `history`, `context_summary`, `ai_personal_prompt`, `response_length_pref`, `response_lang_style`.

## Backend Retrieval

`backend/server.py::_ask_pipeline()`:

1. Validate question.
2. Initialize Vertex AI if needed.
3. Translate Russian-looking questions to Ukrainian for search.
4. Resolve follow-up questions using recent history.
5. Run query embedding and the AI query planner in parallel.
6. Convert plan source features into allowed V2 collections.
7. Search all allowed V2 collections. The old centroid router is disabled.
8. Run vector search for the original question and, when the planner produced a distinct `search_query`, for that planned search query.
9. Merge by `(law_id, chunk_index)`.
10. Apply low-confidence widening when raw score is weak.
11. Apply source and document-type scoring.
12. Deduplicate to max 2 chunks per law id.
13. Apply diversity caps.
14. Expand promising documents with sibling chunks.
15. Add keyword MatchText candidates using planner legal terms, aspects and verified act-title hints.
16. Add title MatchText candidates with a small cap.
17. Run dynamic primary-act discovery. This is not id hardcoding: it promotes current laws/codes/procedures already found by search and expands only real Qdrant documents.
18. Add aspect coverage candidates from the planner so multi-aspect questions do not collapse to one source family.
19. Run deterministic answerability rerank.
20. Optionally run Gemini LLM reranker only when `llm_reranker_enabled=true`.
21. Squeeze final context: keep search wide, but send only the strongest source-strict chunks to Gemini.
22. Filter cancelled/expired documents.
23. Build context buckets.
24. Generate streamed answer and parallel classification.
25. Require a hidden answer-done marker from the model.
26. If the marker is missing or the model hit max tokens, request a short continuation.
27. Strip the marker before returning, streaming final payload, saving analytics or showing citations.

## Query Planner

The old pair of `rewrite` + `act_hints` calls has been replaced by one JSON query planner inside `backend/server.py::_ask_pipeline()`.

The planner returns:

- `search_query`: normalized Ukrainian legal search text for embeddings;
- `legal_terms`: exact legal terms and short acronyms such as `FOP`, `TOV`, `PDV`, `EP`, `CPD` in Ukrainian/Russian spelling when relevant;
- `aspects`: issue dimensions that should be covered, for example taxation, liability, employees, contractors, corporate structure;
- `primary_act_hints`: possible act titles for title search only;
- `source_preferences`: broad source-type hints;
- `should_compare`;
- `needs_clarification`;
- `clarification_questions`.

Planner output is never treated as legal truth. It is only a retrieval plan:

- act hints must resolve to real Qdrant documents before they can influence context;
- no statute number, date, tax rate, limit or legal conclusion from the planner is used in the final answer;
- final answers are still based only on retrieved context and citations.

If `app_settings.query_planner_enabled` is absent, the backend defaults it to enabled. When disabled, the planner falls back to the original question as the search query.

## V2 Collections

Production chat retrieval uses V2 Qdrant collections:

- `rada_finance_v2`
- `rada_state_v2`
- `rada_personnel_v2`
- `rada_court_v2`
- `rada_intl_v2`
- `rada_labor_v2`
- `rada_civil_v2`
- `rada_criminal_v2`
- `rada_admin_v2`
- `rada_housing_v2`
- `rada_land_v2`
- `rada_industry_v2`
- `rada_other_v2`
- `laws_supreme_v2`
- `laws_wiki_v2`
- `laws_ccu_v2`
- `laws_positions_v2`
- `laws_kmu_v2`
- `laws_mod_v2`
- `laws_zir_v2`

V2 uses `gemini-embedding-001`, 3072 dimensions and cosine distance.

## Answerability Reranker

The deterministic reranker is the main precision/speed fix. It scores each chunk by:

- semantic similarity;
- query-term coverage in title and content;
- content coverage, not just title match;
- source authority;
- normative markers such as law/order/procedure/obligation language;
- text quality, penalizing noisy or mixed-language chunks;
- source penalties for broad background sources such as wiki and broad Supreme Court PDFs.

It also limits repeated chunks from the same document and caps wiki chunks so background material cannot dominate final context.

## Context

Context buckets:

- law/general bucket: max 15 chunks;
- KMU bucket: max 8 chunks;
- court bucket: max 6 chunks.

Overall context cap is controlled by `context_char_cap`, default 30,000 characters.

Before context building, the backend runs a strict context squeeze. It does not narrow
the search space; it narrows only the final chunks sent to Gemini:

- `short`: up to 6 chunks;
- `standard`: up to 8 chunks;
- `detailed`: up to 10 chunks;
- `full`: up to 12 chunks.

The squeeze ranks by answerability, content coverage, authority and text quality.
Background sources such as wiki/ZIR are kept to at most one final chunk unless they
are the only useful evidence. Court sources are also capped so they do not dominate
questions that need a normative answer.

## Response Preferences

`response_length_pref`:

| Mode | Token bounds | Target |
| --- | ---: | --- |
| `short` | 1200-1800 | compact answer |
| `standard` | 1800-2600 | up to 400 words |
| `detailed` | 4200-5600 | up to 850 words |
| `full` | 6500-9000 | up to 1600 words |

`response_lang_style`:

- `legal`: precise legal language;
- `plain`: simple non-jargon explanation.

## Answer Completion Contract

The backend no longer guesses completion from answer shape, such as numbered sections.
Gemini is asked to finish with the hidden marker `URAI_DONE`, but the marker is advisory,
not required for a valid answer.

Server behavior:

- if the streamed answer includes the marker, the stream buffer removes it before the user sees it;
- if Gemini reports `MAX_TOKENS`, or the visible text ends in an obviously dangling fragment,
  `_complete_answer_if_needed()` asks for a short continuation;
- continuation can add only the marker when the answer was already complete;
- the marker is stripped before `/ask`, `/ask_stream` citations payload and saved assistant text.

This is format-independent: it works for paragraphs, bullet lists, legal memos, short answers and full analysis.

## Limits And Beta

- Chat UI blocks users over `monthly_limit + bonus_requests`.
- `/api/ask/stream` also has a free-account fingerprint guard.
- Usage increments only after assistant message save.
- Beta users bypass chat UI limit and use effective `pro` features.

## Current Performance Design

Default path now avoids an extra Gemini call for reranking. The retrieval stage uses deterministic answerability reranking first. Gemini LLM reranking is still available behind `llm_reranker_enabled`, but it is not the default because it adds latency and can pick topically similar chunks that do not answer the exact question.
