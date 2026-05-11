# URAI RAG Query Planner

> Updated: May 2026. ASCII-only on purpose. Source of truth: `backend/server.py` and `backend/qdrant_storage.py`.

## Purpose

The query planner is a retrieval helper, not a legal authority.

It exists because a user question like "which is better, FOP or TOV for an IT team?" is not one search problem. It contains several legal aspects: taxation, liability, employees or contractors, corporate structure, limits and sometimes investment planning.

The planner converts the user question into a structured search plan so retrieval can look for those aspects deliberately.

## Runtime Position

The planner runs inside `backend/server.py::_ask_pipeline()` after:

1. The question is validated.
2. Russian-looking text may be translated to Ukrainian.
3. A follow-up question may be resolved using recent chat history.

Then the backend runs two tasks in parallel:

1. Embed the resolved search question.
2. Ask the planner for a JSON search plan.

The planner replaces the older split flow of:

- free-form query rewrite;
- separate act-hints extraction.

## Planner Contract

The planner returns a normalized dict with these fields:

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
  "should_compare": false,
  "needs_clarification": false,
  "clarification_questions": ["string"]
}
```

All fields are sanitized by `_normalize_query_plan()`:

- strings are trimmed and whitespace-normalized;
- lists are deduplicated;
- list sizes and string lengths are capped;
- invalid planner output falls back to `_empty_query_plan(question)`.

If Gemini returns truncated JSON, `_partial_query_plan()` extracts any completed
string/list fields from the partial text. This preserves useful `title_queries`,
`title_must_terms`, `title_nice_terms`, `title_exclude_terms`, `aspects`,
`legal_terms` and `source_preferences` instead of dropping the whole search plan.

## Safety Rules

The planner must never be treated as a source of law.

Planner output may influence:

- embedding query text;
- keyword terms;
- title-search terms;
- dynamic primary-act discovery;
- aspect coverage;
- debug metadata.

Planner output may not directly influence:

- final legal conclusions;
- citations;
- statute or article numbers;
- rates, limits, amounts, dates or deadlines;
- document status;
- recommendations such as "choose FOP" or "choose TOV".

If the planner suggests an act title, that title is only a search hint. The title must match a real Qdrant payload before any document from it can appear in the context.

## Retrieval Use

`search_query`

- Used as the planned semantic search text when it differs from the resolved user question.
- The backend searches both the original resolved question and the planned search query, then merges by `(law_id, chunk_index)`.

`legal_terms`

- Added to keyword fallback.
- Added to title boost.
- Keeps short Ukrainian legal acronyms alive through retrieval. The backend preserves indexed lowercase spellings for FOP, TOV/OOO, PDV, EP, CPD, KVED, KZpP, KMU, DPS and ZIR.

`aspects`

- Added to primary discovery terms.
- Used by aspect coverage so a multi-aspect question does not collapse to one source family.

`title_queries`

- Used before conversational query words in title boost and keyword fallback.
- They are short phrases likely to appear in document titles or stable act families.
- They are search hints only: a title query must still resolve to a real indexed Qdrant document.

`title_must_terms`, `title_nice_terms`, `title_exclude_terms`

- Used by title boost as compact title vocabulary.
- `title_must_terms` are strong positive title hints, for example `Податковий кодекс України` or `критично важливі`.
- `title_nice_terms` are softer supporting hints, for example `воєнний стан` or `компенсація витрат`.
- `title_exclude_terms` remove obvious wrong-domain title matches, for example excluding `електричної енергії` for a food-production support query.
- These fields are hints only. They may boost, demote or reject retrieval candidates, but they never create legal facts.

`primary_act_hints`

- Added to title search terms only.
- A hint that does not resolve to a real indexed document has no authority and does not reach the answer.

`source_preferences`

- Used as a small source-family prior, not as a hard filter.
- Supported broad hints include `rada`, `kmu`, `zir`, `court`, `wiki` and `mod`.

`target_collections`

- Used as exact V2 Qdrant collection hints for the first retrieval pass.
- This is how the planner avoids saying only `rada` when the real choice is a
  narrower Rada collection such as `rada_finance_v2`, `rada_labor_v2` or
  `rada_industry_v2`.
- Values are validated against the production whitelist. Unknown collection
  names are discarded.
- Low-confidence retrieval still expands back to the allowed plan collections,
  so a bad hint should not permanently hide useful documents.
- For Rada categories the planner sees the h-code map:
  - `h2`, `h3`, `h26`, `h23` -> `rada_finance_v2`;
  - `h4` -> `rada_state_v2`;
  - `h27` -> `rada_personnel_v2`;
  - `h22`, `h30`, `h1` -> `rada_court_v2`;
  - `h11` -> `rada_intl_v2`;
  - `h19`, `h20` -> `rada_labor_v2`;
  - `h5`, `h16`, `h13` -> `rada_civil_v2`;
  - `h25` -> `rada_criminal_v2`;
  - `h8`, `h10`, `h31` -> `rada_admin_v2`;
  - `h6`, `h21` -> `rada_housing_v2`;
  - `h9`, `h18` -> `rada_land_v2`;
  - `h7`, `h17`, `h15` -> `rada_industry_v2`;
  - `h12`, `h14`, `h24`, `h28`, `h29`, `h32` -> `rada_other_v2`.

## Dynamic Primary-Act Discovery

The backend does not pin hardcoded law ids.

Primary-act discovery looks at candidates already found by semantic, keyword or title search and scores them by:

- source family;
- document type;
- current/dead status;
- query-term coverage in title and content;
- semantic similarity;
- recency and temporal penalties.

Documents can be promoted only if they are real retrieved candidates and look like current primary normative material, for example:

- Rada laws/codes;
- KMU resolutions;
- ministry orders/instructions where appropriate.

The discovery layer may expand those real documents with sibling chunks from Qdrant. It does not invent documents.

## Aspect Coverage

After primary discovery, the backend selects a small number of protected aspect candidates from the planner's `aspects`.

This protects the final context from common failures:

- tax explanation sources crowding out company-law sources;
- one large document occupying all slots;
- a comparison answer having sources for only one side.

Aspect coverage still uses only retrieved documents. It does not force a document into context if Qdrant found nothing for that aspect.

## Stopwords And Acronyms

Conversational words are removed from search terms. The stopword set covers common "I need a recommendation / which is better / choose / criteria" wording in Ukrainian and Russian.

Short legal acronyms are preserved even when they are shorter than four characters, for example FOP, TOV, PDV, EP, CPD and KVED in their indexed lowercase spellings.

This is important because many Ukrainian legal queries depend on short abbreviations.

## Logging

Expected logs after this change:

- `QUERY PLAN: ...`
- `QUERY PLAN USED: ... target_collections=[...]`
- `COLLECTION SCOPE: hints=[...] prefs=[...] target=[...]`
- `PRIMARY ACT DISCOVERY: ...`
- `ASPECT COVERAGE: ...` when aspects produce protected candidates.
- `FINAL RESULTS: ...`

The older `REWRITE raw=...` and `ACT HINTS: ...` logs should no longer appear from the main chat pipeline.

## Operational Notes

`query_planner_enabled`

- Read from `app_settings` through `settings_cache.get_bool("query_planner_enabled", True)`.
- Defaults to enabled if the setting is absent.
- When disabled, the backend uses the original resolved question as the search plan.

The planner improves retrieval quality but does not replace metadata enrichment. For best answers, the V2 database still needs:

1. Full chunk repair/reindex.
2. OpenData metadata enrichment.
3. Text cancellation scan.
4. Applying cancellation cache to `meta.json`.
5. Patching Qdrant payload metadata.
