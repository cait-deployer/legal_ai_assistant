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
    H --> I[Parallel: query embedding + query rewrite + retrieval hints]
    I --> J[Plan sources -> allowed V2 Qdrant collections]
    J --> K[Routing probe across allowed collections]
    K --> L[Vector search: original and rewrite]
    L --> M[Boost, dedup, diversity, document expansion]
    M --> N[Keyword MatchText + title boost + hint title boost]
    N --> O[Deterministic answerability reranker]
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
5. Run query rewrite, query embedding and optional retrieval hints.
6. Convert plan source features into allowed V2 collections.
7. Probe allowed collections and route to likely collections.
8. Run vector search for original and rewritten queries.
9. Merge by `(law_id, chunk_index)`.
10. Apply low-confidence widening when raw score is weak.
11. Apply source and document-type scoring.
12. Deduplicate to max 2 chunks per law id.
13. Apply diversity caps.
14. Expand promising documents with sibling chunks.
15. Add keyword MatchText candidates.
16. Add title MatchText and hint-title candidates with a small cap.
17. Run deterministic answerability rerank.
18. Optionally run Gemini LLM reranker only when `llm_reranker_enabled=true`.
19. Squeeze final context: keep search wide, but send only the strongest source-strict chunks to Gemini.
20. Filter cancelled/expired documents.
21. Build context buckets.
22. Generate streamed answer and parallel classification.
23. Require a hidden answer-done marker from the model.
24. If the marker is missing or the model hit max tokens, request a short continuation.
25. Run answer quality repair when the draft is too short for a structured legal question or contains invalid citation markers.
26. Strip the marker before returning, streaming final payload, saving analytics or showing citations.

## Retrieval Hints

`retrieval_hints_enabled` controls a soft AI planning step that runs in parallel
with query rewrite. It returns JSON hints, not user-facing legal conclusions:

- `rewritten_query`;
- `likely_act_titles`;
- `must_terms`;
- `article_hints`;
- `collection_roles`;
- `answer_type`;
- `confidence`.

Hints enrich keyword and title search, especially when the user asks casually and
the relevant Rada or KMU document title is not present in the question.

Hard constraints:

- tariff source gating remains the boundary;
- searches still run only inside `plan_collections`;
- hinted collections never unlock sources that the plan did not allow;
- Wiki, ZIR, MOD, Supreme Court, legal positions and CCU are not banned;
- source roles are soft priorities, not filters;
- if a hinted title is not confirmed by Qdrant title search, it is ignored.

The final SSE `_meta` may include `retrieval_hints` and `confirmed_title_hits`
for debugging and eval review.

`_meta.retrieval_debug` contains detailed diagnostics for quality review:

- `timings_ms`: translation, follow-up, rewrite, hints, vector search, document
  expansion, keyword search, title search, rerank and context squeeze timings;
- `counts`: raw hits, added keyword/title/hint chunks, dedup drops and final
  candidate counts;
- `collections`: plan-limited and final target collections;
- `flags`: low-confidence mode, rerank mode, hint status and thresholds;
- `top_candidates` / `top_final`: compact ranked source snapshots.

Backend logs also emit `RAG PLAN`, `RAG VECTOR`, `RAG BOOSTED TOP`,
`RAG KEYWORD`, `RAG TITLE` and `RAG FINAL TOP` lines. For easier reading in
`journalctl`, compact per-source rows use the `RAGDBG` prefix, for example
`RAGDBG VECTOR #01 ...` and `RAGDBG FINAL #01 ...`. These logs are diagnostic
only and do not add hardcoded source or document exceptions.

`title_boost_max_keywords` caps broad title-keyword fanout. Exact title probes
from retrieval hints still run separately, but generic title keywords should stay
small enough to avoid slow noisy Qdrant scrolls.

Budget settings for latency control:

- `title_boost_max_keywords`;
- `title_boost_max_pages`;
- `title_boost_max_docs_per_collection`;
- `doc_expansion_max_docs`;
- `doc_expansion_chunks_per_doc`.

These are generic caps. They should be tuned by eval metrics and logs, not by
hardcoded topic exceptions.

Answer generation also has a generic structure guard: when the question asks for
conditions, requirements, criteria, who is covered, or procedure, even `short`
answers must include several concrete cited points instead of a single generic
sentence. This is query-shape based, not topic-specific.

After generation, `_repair_answer_quality_if_needed()` checks the actual answer.
It triggers one repair pass only for generic quality failures:

- literal `[N]` instead of real citations;
- no real citation numbers while citations exist;
- structured question answered with too few words, too few cited points or no
  visible structure.

The repair uses the already-built prompt and context. It does not run new search,
does not unlock extra collections and does not contain topic-specific source
exceptions. Logs include `ANSWER QUALITY REPAIR` with reasons, before/after
character counts, elapsed time and any remaining quality warnings.

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
| `short` | 800-1200 | compact answer |
| `standard` | 1200-1700 | up to 400 words |
| `detailed` | 2600-3800 | up to 850 words |
| `full` | 4200-6500 | up to 1600 words |

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
- if the final answer is structurally weak or contains `[N]`,
  `_repair_answer_quality_if_needed()` rewrites it once using the same context;
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
