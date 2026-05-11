# URAI RAG Query Planner

> Updated: May 2026. Source of truth: `backend/server.py`.

## Purpose

The query planner is a retrieval helper, not a legal authority.

It converts a user question into a structured search plan so the backend can
look for direct evidence deliberately. This is especially important for:

- comparison questions;
- recommendation questions;
- multi-part "tax benefits, compensation, critical status" questions;
- direct norm questions where a large code contains the answer;
- follow-up questions that depend on previous cited context.

## Runtime Position

The planner runs inside `_ask_pipeline()` after:

1. question validation;
2. optional Russian-to-Ukrainian search translation;
3. follow-up resolution;
4. compact history evidence preparation when useful.

Then two tasks run in parallel:

1. embed the resolved search question;
2. ask Gemini for a JSON search plan.

## Planner Contract

Normalized planner shape:

```json
{
  "search_query": "string",
  "legal_terms": ["string"],
  "aspects": ["string"],
  "title_queries": ["string"],
  "title_must_terms": ["string"],
  "title_nice_terms": ["string"],
  "title_exclude_terms": ["string"],
  "primary_act_hints": ["string"],
  "source_preferences": ["string"],
  "target_collections": ["string"],
  "evidence_subquestions": [
    {
      "id": "string",
      "question": "string",
      "must_find": ["string"],
      "avoid_if_only": ["string"],
      "target_collections": ["string"],
      "source_preferences": ["string"]
    }
  ],
  "should_compare": false,
  "needs_clarification": false,
  "clarification_questions": ["string"],
  "article_hint": null,
  "article_confidence": 0.0
}
```

All fields are sanitized by `_normalize_query_plan()`:

- strings are trimmed and whitespace-normalized;
- lists are deduplicated;
- list sizes and string lengths are capped;
- collection names are validated against the V2 whitelist;
- invalid output falls back to `_empty_query_plan(question)`.

If Gemini returns truncated JSON, partial extraction preserves completed fields,
including `evidence_subquestions`, instead of discarding the whole plan.

## Safety Rules

Planner output may influence:

- embedding query text;
- keyword terms;
- title terms;
- dynamic primary-act discovery;
- target collection hints;
- aspect/evidence coverage;
- article-window retrieval hints;
- debug logs.

Planner output may not directly create:

- final legal conclusions;
- citations;
- statute/article numbers in the answer;
- rates, limits, amounts, dates or deadlines;
- document status;
- recommendations like "choose FOP" or "choose TOV".

Every legal fact must still come from retrieved context.

## Field Usage

### `search_query`

Used as normalized search text. The backend searches both the resolved user
question and this planned query when they differ.

### `legal_terms`

Used for keyword fallback, title boost and scoring. Short legal acronyms are
preserved, including FOP, TOV/OOO, PDV, EP, CPD, KVED, KZpP, KMU, DPS and ZIR
in relevant Ukrainian/Russian spellings.

### `aspects`

Used to protect coverage for independent dimensions such as taxation,
liability, employees, contractors, corporate structure, compensation or
procedure.

### `evidence_subquestions`

Used for retrieval only. Each subquestion describes one evidence block the
answer should try to prove. Example blocks:

- tax treatment;
- who qualifies;
- amount/limit;
- procedure;
- required documents;
- exceptions;
- liability/risk.

The backend adds their `question` and `must_find` terms to evidence search and
coverage scoring. `avoid_if_only` terms help demote candidates that are
topically close but answer the wrong domain.

### Title Fields

`title_queries`, `title_must_terms`, `title_nice_terms` and
`title_exclude_terms` guide title MatchText and title scoring. They are hints,
not hard filters, and must resolve to real indexed Qdrant payloads.

### `primary_act_hints`

Search hints for likely act titles. A hint has no authority unless it resolves
to a real indexed document.

### `source_preferences`

Small source-family priors, not hard filters. Supported broad values include:

- `rada`
- `kmu`
- `zir`
- `court`
- `wiki`
- `mod`

### `target_collections`

Exact V2 collection hints for the first retrieval pass. Unknown names are
discarded. Low-confidence retrieval can widen safely back to allowed
collections.

## Numeric And Word Variants

The backend expands numeric tokens into Ukrainian word variants where useful.
For example, a query containing `20` can search for variants such as
`двадцять` and `двадцяти`. This is generic numeric matching, not a hardcoded
speed-fine rule.

## Follow-Up Evidence Carry

For follow-up or recommendation-continuation questions, the backend can extract
a compact summary of previously cited assistant claims and add it to retrieval
terms. This helps a second question like "so what should I choose?" reuse the
sources already found in the previous answer.

The carried history is not treated as law. It only helps retrieval and is
marked separately in the final prompt.

## Dynamic Primary-Act Discovery

The backend does not pin hardcoded law ids.

Primary-act discovery promotes current primary normative material already found
by search:

- Rada laws/codes;
- KMU resolutions/procedures;
- ministry orders/procedures when appropriate, including MOD.

It can expand those real documents with sibling chunks. It does not invent
documents.

## Article Window

Large legal acts often split condition and consequence across neighboring
chunks. For direct norm/article questions, the backend can protect a contiguous
window around likely article chunks: N-1, N and N+1 when useful.

This fixed cases where the answer saw only the sanction for "more than 50 km/h"
but missed the preceding clause for "more than 20 km/h".

## Aspect Coverage

After primary discovery and reranking, the backend protects a small number of
additional candidates that cover planner aspects/evidence. This prevents:

- one source family from crowding out the other side of a comparison;
- tax/ZIR sources crowding out company-law sources;
- broad wiki/court context replacing direct norms.

Coverage candidates must still be real retrieved documents and pass quality
checks.

## Logging

Expected logs:

- `QUERY PLAN BASE`
- `QUERY PLAN AI`
- `QUERY PLAN FINAL`
- `QUERY PLAN USED`
- `COLLECTION SCOPE`
- `PRIMARY ACT DISCOVERY`
- `ARTICLE FINAL GUARANTEE`
- `ASPECT COVERAGE`
- `EVIDENCE COVERAGE`
- `FOLLOWUP EVIDENCE CARRY`
- `CONTEXT SQUEEZE`
- `FINAL RESULTS`

Older `REWRITE raw=...` and separate `ACT HINTS` should not be considered the
current main chat flow.

## Operational Notes

`query_planner_enabled` defaults to enabled if the setting is absent. When
disabled, the backend uses the resolved question as the basic search plan.

The planner improves retrieval quality, but good answers still depend on:

1. complete V2 scraping/reindex;
2. OpenData metadata enrichment;
3. text cancellation scan;
4. Qdrant payload metadata patching;
5. eval-case driven tuning.
