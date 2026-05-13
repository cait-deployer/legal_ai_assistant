# Prompt For Next Chat: URAI RAG Quality Work

You are a senior fullstack architect and RAG engineer working on URAI, a
Ukrainian-law legal assistant. Your goal is to improve answer quality without
breaking the current production flow.

## Read First

Before changing code, read:

- `CHATBOT_FLOW.md`
- `URAI_ARCHITECTURE.md`
- `RAG_QUERY_PLANNER.md`
- `backend/server.py`
- `backend/retrieval_helpers.py`
- `backend/schemas.py`
- `backend/qdrant_storage.py`
- the specific frontend/API files you will touch.

If editing Next.js code, read the relevant local docs in
`node_modules/next/dist/docs/` because this project has version-specific
Next.js rules.

## Current State

The chat already uses V2 Qdrant collections and `gemini-embedding-001`.
The backend has been partially split: `server.py` still owns `_ask_pipeline()`,
while many helper functions live in `retrieval_helpers.py` and admin/utility
route groups live in `*_routes.py` modules.

Important implemented features:

- AI query planner with `search_query`, legal terms, title hints, target
  collections and `evidence_subquestions`.
- Deterministic answerability reranker as the default precision path.
- Optional Gemini LLM reranker behind `llm_reranker_enabled`.
- Follow-up resolver and compact history evidence carry.
- Generic numeric-word expansion, for example `20` can match Ukrainian word
  forms such as `двадцять`.
- Article-window protection for direct norm/article questions.
- Aspect/evidence coverage for multi-part questions.
- MOD and ZIR source integration.
- Source-role reranking in `backend/source_reranking.py`, controlled by
  `source_role_rerank_enabled`. It is policy-based and generic: source role and
  intent may add a small ranking signal, but the module must not know answers
  for individual questions.
- Completion marker `URAI_DONE` and backend continuation logic.
- Frontend stop-generation UX.
- Beta tester chat UX: one-time welcome modal after the first saved assistant
  answer, plus inline like/dislike message feedback. The old per-answer
  auto-open feedback modal is not current behavior.

## Quality Problems Still Worth Solving

1. Some broad recommendation questions still get partial context for only one
   side of a comparison.
2. Some answers are too long when the direct norm is already present.
3. Some specific named-entity documents can still appear in general answers.
4. Some source families can be useful but should not dominate when a direct
   primary norm exists.
5. Legal constants are still a planned layer, not current runtime behavior.
   Without it, the bot may correctly cite "20 NMDG" but should not invent the
   hryvnia amount unless that constant is present in retrieved context.
6. More quality work should be measured with approved/gold eval cases instead
   of manual inspection only.

## Rules For Improvements

- Do not hardcode one-off answers.
- Do not globally boost a collection without evidence.
- Do not remove wiki/ZIR/MOD; treat them by source role and directness.
- Keep changes small, testable and reversible.
- Prefer feature flags for risky behavior.
- Never make the pipeline more expensive for every request unless the quality
  benefit is measured.
- Do not rewrite the whole backend in one pass.

## Good Next Steps

### 1. Evaluation First

Add or improve tooling around `rag_eval_cases`:

- store expected sources and bad sources;
- run retrieval-only evaluation against approved/gold cases;
- report hit@5, hit@10, bad-source rate and missed expected sources;
- compare before/after changes.

### 2. Source Quality Scoring

Improve scoring as a normalized combination of:

- vector similarity;
- lexical/title coverage;
- directness;
- source authority;
- recency/current-status signals;
- gold-case similarity boost;
- bad-source similarity penalty;
- background-only penalty.

All weights should be configurable or easy to tune. Scores from different
families must be normalized before combining.

### 3. Named-Entity Generality Filter

For general legal questions, documents about a specific company, auction,
privatization object, procurement or other named entity should be downgraded
unless the user asked about that exact entity. This should be a general
specificity/directness rule, not a list of forbidden companies.

### 4. Answer Mode Tuning

For direct norm questions, prefer:

- direct answer first;
- one or two caveats;
- only sources that support the norm.

For procedure questions, prefer:

- who qualifies;
- conditions;
- documents/data needed;
- where/how to submit;
- risks.

For recommendation questions, prefer:

- scenario-based orientation;
- sourced criteria;
- missing criteria;
- 1-3 clarifying questions.

## Definition Of Done

A RAG improvement is done only when:

- it compiles;
- `git diff --check` passes;
- at least several known questions are manually rechecked;
- if possible, eval cases show no regression;
- logs explain why sources were selected;
- the change can be reverted cleanly.
