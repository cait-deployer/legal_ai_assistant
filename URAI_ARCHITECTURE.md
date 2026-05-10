# URAI - С‚РµС…РЅС–С‡РЅР° Р°СЂС…С–С‚РµРєС‚СѓСЂР° С‡Р°С‚Р±РѕС‚Р°

> РђРєС‚СѓР°Р»СЊРЅРёР№ Р·СЂС–Р· СЃРёСЃС‚РµРјРё СЃС‚Р°РЅРѕРј РЅР° С‚СЂР°РІРµРЅСЊ 2026.
> Р”Р¶РµСЂРµР»Рѕ РїСЂР°РІРґРё: `app/chat/page.tsx`, `app/api/ask/stream/route.ts`, `app/api/ask/route.ts`, `backend/server.py`, `backend/qdrant_storage.py`.

## 1. РљРѕРјРїРѕРЅРµРЅС‚Рё

URAI СЃРєР»Р°РґР°С”С‚СЊСЃСЏ Р· С‚СЂСЊРѕС… РѕСЃРЅРѕРІРЅРёС… С€Р°СЂС–РІ:

| РЁР°СЂ | РўРµС…РЅРѕР»РѕРіС–С— | Р’С–РґРїРѕРІС–РґР°Р»СЊРЅС–СЃС‚СЊ |
| --- | --- | --- |
| Frontend | Next.js App Router, React | Chat UI, settings, admin panel, auth UX, streaming display |
| API routes | Next.js Route Handlers | Supabase auth, plan gating, profile/preferences, proxy РґРѕ backend |
| Backend | FastAPI Python | Retrieval, Qdrant, Gemini/Vertex AI, sync/reindex/admin endpoints |
| Storage | Supabase + Qdrant | Users/chats/messages/analytics/settings + vector knowledge base |

## 2. Chat request flow

1. User РЅР°РґСЃРёР»Р°С” РїРёС‚Р°РЅРЅСЏ Сѓ `app/chat/page.tsx`.
2. РЇРєС‰Рѕ С‡Р°С‚ РЅРѕРІРёР№, frontend СЃС‚РІРѕСЂСЋС” row Сѓ `chats`.
3. User message Р°СЃРёРЅС…СЂРѕРЅРЅРѕ Р·Р±РµСЂС–РіР°С”С‚СЊСЃСЏ Сѓ `messages`.
4. Frontend С„РѕСЂРјСѓС” `history` Р· РѕСЃС‚Р°РЅРЅС–С… 6 РїРѕРІС–РґРѕРјР»РµРЅСЊ.
5. Frontend РІРёРєР»РёРєР°С” `POST /api/ask/stream` Р· `question`, `history`, `context_summary: null`.
6. API route С‡РёС‚Р°С” profile, plan, enabled features С– response preferences.
7. API route РІС–РґРїСЂР°РІР»СЏС” payload Сѓ FastAPI `/ask_stream`.
8. Backend РІРёРєРѕРЅСѓС” retrieval pipeline С– stream-РёС‚СЊ С‚РѕРєРµРЅРё РЅР°Р·Р°Рґ.
9. Frontend РїРѕРєР°Р·СѓС” tokens live.
10. РџС–СЃР»СЏ С„С–РЅР°Р»СЊРЅРѕРіРѕ citations event frontend Р·Р±РµСЂС–РіР°С” assistant message, analytics С– РѕРЅРѕРІР»СЋС” usage.
11. РџС–СЃР»СЏ РєРѕР¶РЅРѕРіРѕ 2-РіРѕ user turn Р·Р°РїСѓСЃРєР°С”С‚СЊСЃСЏ `POST /api/chats/[id]/summarize`, Р°Р»Рµ summary Р·Р°СЂР°Р· РЅРµ РїС–РґСЃС‚Р°РІР»СЏС”С‚СЊСЃСЏ Сѓ РЅР°СЃС‚СѓРїРЅРёР№ ask payload.

## 3. API route contract

`AskRequest` Сѓ backend:

```json
{
  "question": "string",
  "max_docs": 12,
  "filter_sources": ["rada", "kmu", "wiki"],
  "response_features": ["response_detailed", "response_steps"],
  "user_profile": {
    "role": "Р®СЂРёСЃС‚ / РђРґРІРѕРєР°С‚",
    "sub_role": ["..."],
    "segment": ["..."]
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

`/api/ask/stream` and `/api/ask` СЂРѕР±Р»СЏС‚СЊ РѕРґРЅР°РєРѕРІСѓ plan/profile РїС–РґРіРѕС‚РѕРІРєСѓ. Streaming endpoint РґРѕРґР°С‚РєРѕРІРѕ РјР°С” free fingerprint guard.

## 4. Plans, beta С– features

Effective plan:

- СЏРєС‰Рѕ `profiles.is_beta_tester = true`, plan РїРѕРІРѕРґРёС‚СЊСЃСЏ СЏРє `pro`;
- С–РЅР°РєС€Рµ РІРёРєРѕСЂРёСЃС‚РѕРІСѓС”С‚СЊСЃСЏ `profiles.subscription_tier`.

Plan data:

- `subscription_plans.max_docs_retrieved` -> `max_docs`;
- `plan_features` -> `filter_sources` С– `response_features`.

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

Current behavior: СЏРєС‰Рѕ РїР»Р°РЅ РјР°С” С…РѕС‡Р° Р± РѕРґРЅРµ source feature, API route РґРѕРґР°С” `mod` С– `zir` Р°РІС‚РѕРјР°С‚РёС‡РЅРѕ РґРѕ `filter_sources`.

Response features:

| Feature | Effect |
| --- | --- |
| `response_detailed` | Р’РјРёРєР°С” detailed/full instructions, СЏРєС‰Рѕ user preference С†Рµ РґРѕР·РІРѕР»СЏС” |
| `response_steps` | Р”РѕРґР°С” "Р©Рѕ СЂРѕР±РёС‚Рё РґР°Р»С–" Р°Р±Рѕ РєРѕСЂРѕС‚РєС– next steps |
| `response_scenarios` | Р”РѕРґР°С” Р°Р»СЊС‚РµСЂРЅР°С‚РёРІРЅС– СЃС†РµРЅР°СЂС–С— РґР»СЏ detailed/full |
| `response_vs_position` | РџСЂРѕСЃРёС‚СЊ РІРёРєРѕСЂРёСЃС‚Р°С‚Рё РїРѕР·РёС†С–С— Р’РµСЂС…РѕРІРЅРѕРіРѕ РЎСѓРґСѓ, СЏРєС‰Рѕ РІРѕРЅРё С” РІ context |

Response preference gating:

- `full` РґРѕСЃС‚СѓРїРЅРёР№ С‚С–Р»СЊРєРё Pro/Beta;
- `detailed` РґРѕСЃС‚СѓРїРЅРёР№ paid/Beta;
- locked preferences silently downgrade to `standard`.

## 5. Qdrant collections

Production chat search currently uses V2 collections from `ALL_V2_COLLECTIONS`.

Rada V2:

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

Other V2:

- `laws_supreme_v2`
- `laws_wiki_v2`
- `laws_ccu_v2`
- `laws_positions_v2`
- `laws_kmu_v2`
- `laws_mod_v2`
- `laws_zir_v2`

V2 properties:

- embedding: `gemini-embedding-001`;
- vector size: 3072;
- distance: cosine;
- search helpers: `search_qdrant`, `search_qdrant_in_law`, `search_qdrant_text`, `search_qdrant_by_title`;
- text indexes expected on `content` and `source`.

Legacy V1 collections and scripts still exist, but main chat retrieval no longer treats V1 as production source.

## 6. Rada category mapping

Rada documents are split by thematic categories:

| Rada codes | Collection |
| --- | --- |
| `h2`, `h3`, `h26`, `h23` | `rada_finance_v2` |
| `h4` | `rada_state_v2` |
| `h27` | `rada_personnel_v2` |
| `h22`, `h30`, `h1` | `rada_court_v2` |
| `h11` | `rada_intl_v2` |
| `h19`, `h20` | `rada_labor_v2` |
| `h5`, `h16`, `h13` | `rada_civil_v2` |
| `h25` | `rada_criminal_v2` |
| `h8`, `h10`, `h31` | `rada_admin_v2` |
| `h6`, `h21` | `rada_housing_v2` |
| `h9`, `h18` | `rada_land_v2` |
| `h7`, `h17`, `h15` | `rada_industry_v2` |
| `h12`, `h14`, `h24`, `h28`, `h29`, `h32` | `rada_other_v2` |

## 7. Ingestion and reindex

Primary V2 ingestion path:

- `scrape_all_v2.py` saves raw text/meta to `/root/laws_raw/{source}/{law_id}.txt` and `.meta.json`;
- `reindex_v2.py` chunks, embeds and uploads to V2 Qdrant collections;
- per-source scanners also upload directly for some sources:
  - `wiki_scanner.py` -> `laws_wiki_v2`;
  - `kmu_scanner.py` -> `laws_kmu_v2`;
  - `supreme_scanner.py` -> `laws_supreme_v2`;
  - `ccu_scanner.py` -> `laws_ccu_v2`;
  - `lpd_scanner.py` -> `laws_positions_v2`.

Admin pages:

- `/admin/v2` for V2 scrape/reindex;
- `/admin/sync` for source overview and centroid/router status;
- `/admin/meta` for enriched metadata and Qdrant payload patching;
- legacy `/admin/reindex` and `/admin/scraper` still reference older flows.

## 8. Retrieval pipeline

Backend `_ask_pipeline()`:

1. Validate `question`.
2. Initialize Vertex AI if needed.
3. RU -> UA translation if language heuristic detects Russian.
4. Follow-up resolver rewrites short/ambiguous questions using last 6 messages.
5. Query rewrite converts conversational text into legal search terms.
6. Query embedding uses V2 embedder.
7. Plan source filter builds allowed V2 collections.
8. Routing probe searches top-1 per allowed collection and selects relevant collections.
9. Multi-query vector search runs original embedding and rewrite embedding.
10. Results are merged by `(law_id, chunk_index)`.
11. Low-confidence mode widens target collections and changes answer guardrails.
12. Source and doc type scoring adjusts similarity.
13. Global dedup keeps max 2 chunks per law_id.
14. Diversity caps court/positions and distributes slots across collections.
15. Document-set expansion fetches sibling chunks inside relevant laws.
16. Keyword search uses Qdrant MatchText on `content`.
17. Title boost uses Qdrant MatchText on `source` and can fetch chunks from matched documents.
18. Protected slots preserve some KMU/positions/full-law chunks.
19. Deterministic answerability reranker selects final candidates by semantic score, query-term coverage, content coverage, source authority, normative markers and text quality.
20. Gemini LLM reranker is optional behind `llm_reranker_enabled`; default is deterministic reranking for speed and stability.
21. Hard stop can return "not enough information" without main Gemini answer.
22. Expired/cancelled documents are removed.
23. Final context is squeezed: search remains wide, but only the strongest source-strict chunks are sent to Gemini.
24. Context is bucketed and capped.
25. Main Gemini answer and classification are prepared.

## 9. Context building

Context buckets:

| Bucket | Collections | Max chunks |
| --- | --- | ---: |
| `law_chunks` | Rada, wiki, MOD, ZIR, other non-KMU/non-court | 15 |
| `kmu_chunks` | `laws_kmu_v2` | 8 |
| `court_chunks` | `laws_positions_v2`, `laws_supreme_v2`, `laws_ccu_v2` | 6 |

Overall context cap: `context_char_cap`, default 30 000 characters.

Final context squeeze:

- keeps wide retrieval across all allowed collections;
- ranks final chunks by answerability score, content coverage, source authority and text quality;
- caps background sources such as wiki/ZIR to one final chunk by default;
- caps court sources so court practice does not dominate normative questions;
- target chunks: short 6, standard 8, detailed 10, full 12.

Each chunk context header can include:

- source/title;
- doc type;
- law id;
- status;
- effective/scraped date;
- wartime/suspended/retroactive warnings.

Cancelled/expired documents are filtered out before context and citations.

## 10. Answer generation

Main answer:

- model name from `app_settings.ai_model`;
- system prompt from `app_settings.system_prompt`;
- generation config uses `temperature`, `top_p`, `max_output_tokens`;
- thinking budget is disabled when supported;
- streamed through `/ask_stream`.

Classification:

- runs in parallel with main generation;
- returns `sentiment`, `complexity_score`, `user_intent`;
- used for analytics metadata.

Completion guard:

- every main Gemini answer is asked to end with hidden marker `URAI_DONE`, but the marker is advisory;
- streaming buffers a small tail so the marker is removed before the user sees it;
- if finish reason indicates truncation, or visible text ends in an obviously dangling fragment, backend tries `_complete_answer_if_needed()`;
- continuation is appended to stream if generated;
- marker is stripped before `/ask`, `/ask_stream` final citations payload and saved assistant text.

## 11. Response length and style

`response_length_pref`:

| Mode | Token bounds | Word target |
| --- | ---: | ---: |
| `short` | 1200-1800 | compact, no strict word count |
| `standard` | 1800-2600 | up to 400 words |
| `detailed` | 4200-5600 | up to 850 words |
| `full` | 6500-9000 | up to 1600 words |

`response_lang_style`:

- `legal`: precise legal terminology;
- `plain`: simple explanation without legal jargon.

Every legal claim is instructed to have `[N]` citation. If context is weak, backend adds guardrails to show what was found and ask one clarifying question.

## 12. Usage, limits and persistence

Tables involved:

- `profiles`: subscription, limits, beta, preferences, onboarding profile;
- `chats`: chat metadata and `context_summary`;
- `messages`: user/assistant messages and citations;
- `query_analytics`: query text, answer, category, timing, tokens, IP;
- `subscription_plans`: plan limits;
- `plan_features`: enabled sources/response features.

Limit behavior:

- chat UI blocks if user is over limit;
- beta bypasses chat UI limit and effective plan is `pro`;
- `/api/ask/stream` has a free fingerprint abuse guard;
- usage increments after assistant message is saved;
- if generation fails before assistant save, usage does not increment.

Deletion behavior:

- admin user delete removes/deletes Auth user if possible;
- profile row is anonymized as `Deleted user` with `auth_provider = deleted`;
- chats/messages/analytics are preserved for historical records;
- user admin list hides profiles with `auth_provider = deleted`.

## 13. Performance hotspots

The current full pipeline is quality-first and can be heavy under concurrency.

High-cost operations per request:

- RU -> UA Gemini translation;
- follow-up resolver Gemini call;
- query rewrite Gemini call;
- Qdrant routing probe across collections;
- original + rewrite vector search;
- document expansion;
- keyword MatchText scroll;
- title MatchText scroll;
- deterministic answerability reranker;
- optional Gemini reranker if `llm_reranker_enabled=true`;
- main Gemini streamed answer;
- classification Gemini call;
- optional completion call;
- background summarize/title generation after answer.

Likely symptoms under load:

- backend timeout;
- frontend "server unavailable";
- weak/empty retrieval because routing/search timed out or narrowed too much;
- delayed first token because all retrieval/rerank happens before main generation.

## 14. Known mismatches to watch

- `context_summary` is generated and stored but currently not sent into generation from chat UI.
- `tokens_used` in SSE meta is currently not a real token count and often remains `0`.
- `source_legalaid` maps to `laws_wiki_v2`, but old permission helper still names `legalaid.gov.ua` in places.
- Legacy V1 docs/scripts still exist; do not infer current chat behavior from old V1 admin labels.
- `mod` and `zir` are automatically added when any source feature exists.

## 15. Stable rollback idea

Before large optimization work, create a git commit that captures the current stable state. Then each optimization can be tested in small commits and reverted independently.

Recommended rollback commands:

```bash
git log --oneline -5
git revert <commit_sha>
```

Avoid `git reset --hard` on shared/local dirty work unless explicitly intended.
