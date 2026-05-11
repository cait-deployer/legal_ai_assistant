# URAI — AI Legal Assistant

## Deploy
```
ssh root@n-ai01.nexchance.de
cd /home/devops/app && git pull
# Python changes only:
systemctl restart backend.service
# JS/TS changes:
npm run build && systemctl restart frontend.service
# Both changed:
npm run build && systemctl restart frontend.service && systemctl restart backend.service
```

## Architecture
- `app/` — Next.js frontend (pages, API routes)
- `app/api/` — Next.js API routes (proxy to Python backend)
- `backend/server.py` — FastAPI backend, main entry point
- `backend/qdrant_storage.py` — Qdrant vector DB interface (19 v2 collections + 15 v1 collections)
- `backend/rada_scanner.py` — Rada law scraper + `get_all_legal_ids()`, `get_law_text()`, `get_law_metadata()`
- `backend/kmu_scanner.py` — KMU law scraper + `get_all_kmu_docs()`
- `backend/ccu_scanner.py` — Constitutional Court scraper
- `backend/lpd_scanner.py` — Supreme Court legal positions scraper (lpd.court.gov.ua) + `fetch_all_positions()`
- `backend/settings_cache.py` — Settings from Supabase (cached in memory)
- `backend/rada_to_supabase.py` — LangChain embeddings helper (Vertex AI `text-embedding-004`)
- `backend/reindex_rada_full.py` — Full reindex of all 12 rada_* collections (v1)
- `backend/reindex_kmu_full.py` — Full reindex of laws_kmu collection (v1)
- `backend/repair_missing.py` — Targeted repair: re-indexes only laws missing from Qdrant (v1)
- `backend/embed_v2.py` — Embedding module v2: `gemini-embedding-001` (3072 dims), lazy init, thread-safe. Raises on 3rd failure — never stores zero vectors.
- `backend/scrape_all_v2.py` — "Last scraper ever": saves all raw texts to `/root/laws_raw/` (all 6 sources), pause/resume per source
- `backend/scrape_mod_v2.py` — MOD scraper: Playwright-based PDF downloader for mod.gov.ua. OCR fallback via Tesseract (ukr+rus+eng) for scanned PDFs. Entry point: `run_scrape_mod(log_callback, stop_event)`
- `backend/scrape_zir_v2.py` — ZIR scraper: POST API для отримання ID + requests+BeautifulSoup для індивідуальних сторінок. ~5900 Q&A. Entry point: `run_scrape_zir(log_callback, stop_event)`
- `backend/reindex_v2.py` — Reads from disk, chunks, embeds with embed_v2, uploads to `*_v2` Qdrant collections. Safe order: embed first → delete old → upload. Per-source state files.
- `backend/enrich_opendata_meta.py` — Enriches `.meta.json` files with full Liga-Zakon-quality metadata from `data.rada.gov.ua` OpenData API. 3 phases: (1) fetch cards, (2) build reverse-dead index, (3) write `rada_*` fields to `.meta.json`. Entry: `run_enrich(log_callback, stop_event, sources, force)`
- `backend/update_qdrant_meta.py` — Patches Qdrant payload (set_payload) with enriched `rada_*` fields from `.meta.json` without re-embedding. Entry: `run_update_qdrant(log_callback, stop_event, sources)`

## Data Sources (8 sources scraped to /root/laws_raw/)

| Source | Site | Що містить | Розмір | Навіщо |
|--------|------|-----------|--------|--------|
| `rada` | zakon.rada.gov.ua | Всі закони, кодекси, постанови ВР України | ~15 500 doc | Основа: первинне законодавство |
| `kmu` | kmu.gov.ua / zakon.rada.gov.ua | Постанови, розпорядження, накази КМУ | ~10 000+ doc | Підзаконні акти виконавчої влади |
| `ccu` | ccu.gov.ua | Рішення і висновки Конституційного суду | ~300–500 doc | Тлумачення Конституції, скасування норм |
| `supreme` | reyestr.court.gov.ua | Постанови пленуму ВС, узагальнення судової практики | ~1 000+ doc | Офіційна судова практика |
| `wiki` | https://legalaid.wiki | Юридичні терміни, визначення правових понять | ~кілька тис. | Пояснення термінів для бота |
| `positions` | lpd.court.gov.ua | Правові позиції Верховного суду по категоріях справ | ~12 800 doc | Конкретні позиції ВС — найточніші відповіді |
| `mod` | mod.gov.ua | Накази, порядки, методичні матеріали МОУ (PDF) | ~210 doc | Кадрова/фінансова/майнова діяльність військових |
| `zir` | zir.tax.gov.ua | Q&A ДПС: офіційні роз'яснення по податковому законодавству | ~5 900 doc | Практична позиція ДПС (ПДВ, ФОП, акциз, ПДФО) |

### Формат зберігання на диску
```
/root/laws_raw/{source}/{law_id}.txt       — текст документу
/root/laws_raw/{source}/{law_id}.meta.json — метадані (title, url, date, category...)
/root/laws_raw/scrape_status.json          — статус скрапінгу по всіх документах
```

## Admin panel pages (app/admin/)
Every admin page must stay accurate. When you add/change backend functionality, update the matching admin page:
- `app/admin/reindex/page.tsx` — Reindex control (KMU + Rada panels, start/stop/resume) — v1
- `app/admin/ai-settings/page.tsx` — AI model settings, thresholds
- `app/admin/scraper/page.tsx` — Scraper control panel
- `app/admin/coverage/page.tsx` — Collection coverage stats
- `app/admin/stats/page.tsx` — System stats / usage
- `app/admin/v2/page.tsx` — V2 панель (Скрапер / Реіндекс / Аналітика / Диск / Джерела)
- `app/admin/sync/page.tsx` — Зведення джерел + Centroid Router + Авто-синхронізація (розклад per source)
- `app/admin/meta/page.tsx` — Браузер збагачених метаданих (Rada + KMU): фільтри, таблиця, контроль збагачення
- `app/admin/feedback/page.tsx` — Перегляд inline відгуків (👍👎) та рейтингів застосунку (⭐), пагінація, статистика

## Chat flow (end-to-end)

### 1. User submits message (`app/chat/page.tsx` → `handleSend()`)
1. Frontend checks `limitExceeded` (= `requests_this_month >= monthly_limit + bonus_requests`) — aborts if true.
2. If no active chat exists, creates one via `POST /api/chats`.
3. Saves user message to DB: `POST /api/chats/[chatId]/messages` (non-blocking).
4. Fetches `/api/ask/stream` — SSE stream.

### 2. SSE proxy (`app/api/ask/stream/route.ts`)
- Authenticates user; fetches profile (`subscription_tier`, `role`, `sub_role`, `segment`, `ai_personal_prompt`, `response_length_pref`, `response_lang_style`).
- Queries `subscription_plans` for `max_docs_retrieved` and `plan_features` (controls which sources are searched).
- Silently downgrades preferences if plan doesn't allow: `full`/`detailed` → `standard` for free; `plain` → `legal` for free.
- Source gating via `filter_sources[]` from `SOURCE_FEATURE_MAP`: `radar`→`rada`, `source_legalaid`→`wiki`, `source_supreme`→`supreme`, etc. `mod` and `zir` always included.
- Proxies to backend `/ask_stream` as `new Response(res.body, ...)` — raw stream passthrough.

### 3. Backend pipeline (`backend/server.py` → `_ask_pipeline()`)
1. **Query rewrite** — detects Russian, translates to Ukrainian; resolves follow-ups from history; rewrites to formal legal terminology via flash model.
2. **Parallel embedding** — embeds both original and rewritten query.
3. **Collection routing** — `_classify_and_route()` narrows to 2–3 most relevant collections from `filter_sources`.
4. **Multi-query retrieval** — searches both query vectors; merges by max similarity per `law_id`; fetches `fetch_k = max_docs × 5` candidates.
5. **Boosting** — `rada_boost=1.15`, `supreme_penalty=0.88`, `zir_boost=1.3` (tax queries), `_DOC_TYPE_SCORE` (Codes > Laws > Resolutions > Orders).
6. **Deduplication** — max 2 chunks/law globally; guaranteed slots per collection; court results capped at `max_docs/4`.
7. **Document expansion** — top seed (score ≥0.75) gets all chunks (up to 20); others get 3 best chunks via vector + keyword per doc.
8. **Keyword fallback** — parallel lexical search fills gaps from vector search.
9. **LLM generation** — Gemini model with context (last 6 messages + `context_summary` + retrieved docs + user profile). Classification model runs in parallel.
10. **Citation extraction** — `_citations_used_in_answer()` returns only refs cited as `[N]` in answer text.

### 4. SSE event format (backend → frontend)
```
event: status\ndata: {"step": "started"|"retrieval"|"generation", ...}
event: message\ndata: {"token": "word"}        ← one per streaming token
event: citations\ndata: {"answer": "...", "references": [...], "templates": [], "_meta": {...}}
event: done\ndata: {"request_id": "..."}
```
Early-answer path skips `message` events and emits `citations` directly.

### 5. Frontend stream consumption
- Reads with `ReadableStream` / `getReader()` — manual `event:`/`data:` parsing (not `EventSource`).
- **Typewriter effect**: tokens queued in `twQueueRef`, drained at 18ms/tick (6ms if backlog), 1–6 chars per tick.
- On `citations` event: flushes typewriter instantly, updates message with final answer + references.
- `[1]`, `[2,3]` inline markers parsed by `MarkdownText` into clickable citation buttons.
- Citation dialog shows enriched metadata: `rada_adopted_date`, `rada_last_edition`, `rada_dead_since`, `rada_theme`, `rada_org`, `rada_replaced_by`, `rada_cancelled_by`, `rada_doc_type`.

### 6. Message save & usage counter (`app/api/chats/[id]/messages/route.ts`)
- Saves assistant message + citations to `messages` table.
- **FREE plan**: `isFree = (subscription_tier === "free")` → increments `requests_this_month` only, never sets `limit_reset_at` (one-time 10 requests, no reset).
- **Paid plans**: 30-day rolling window — sets `limit_reset_at = now + 30d` on first request; resets `requests_this_month = 0` when window expires.
- Marks `trial_used = true` on first ever interaction.
- Saves analytics row to `query_analytics` (category, sentiment, complexity, intent, tokens_used, processing_time_ms).

### 7. Post-response actions
- Every 2nd user turn: context summarization via `POST /api/chats/[chatId]/summarize` → backend `/summarize_history` → stored in `chats.context_summary`. Summarizes all messages except last 2 (= last complete turn). Passed to backend on next request.
- After first message: chat title generated via `PATCH /api/chats/[chatId]/name` (Vertex AI parses first Q&A → `{title, category}`).
- `refreshLimit()` called after each response to re-check `limitExceeded` state.

### Plan gating summary
| What | Where gated | How |
|------|-------------|-----|
| Request count limit | Frontend UX only | `requests_this_month >= monthly_limit + bonus_requests` |
| Source access | SSE proxy | `filter_sources[]` from `plan_features` |
| Retrieval depth | SSE proxy | `max_docs_retrieved` from `subscription_plans` |
| Response features | SSE proxy + backend | `response_features[]` (detailed, steps, scenarios, vs_position) |
| Response style | SSE proxy (silent downgrade) | `response_length_pref`, `response_lang_style` |
| 429 handling | Frontend | Backend doesn't block — frontend catches 429 and sets `limitExceeded` |

## Key patterns
- Settings (AI model, thresholds) — Supabase `app_settings` table, read via `settings_cache`
- Qdrant V2 collections (production): `RADA_V2_COLLECTIONS` (13) + `OTHER_V2_COLLECTIONS` (7) = 20 total, 3072 dims (`gemini-embedding-001`)
- V1 collections (`rada_finance`, `laws_kmu`, etc.) are no longer used in any live code path — all init/search/stats use V2 only
- `/ask` endpoint: embed → parallel Qdrant search → boost Rada scores → Gemini (full JSON response)
- `/ask_stream` endpoint: same pipeline via `_ask_pipeline()` helper → SSE streaming. Events: `data: {"token":"..."}` per chunk, `event: citations\ndata: {...}` at end (full answer + references + _meta). Early-answer path also uses `event: citations`.
- Response style preferences: `response_length_pref` (short/standard/detailed/full) and `response_lang_style` (legal/plain) stored in `profiles` table. Gated by plan tier — downgraded silently in Next.js route. Word limits (hard constraints in prompt): short=100-180, standard=500-900, detailed=1000-1600, full=1600-2500.
- Next.js SSE proxy: `app/api/ask/stream/route.ts` — same auth + plan gating as `/api/ask`, proxies stream from backend via `new Response(res.body, ...)`. Chat page reads stream with `ReadableStream` / `getReader()`, appends tokens live, finalizes on `event: citations`.
- Auto-sync scheduler: APScheduler `daily_sync` cron job at `schedule_hour` UTC. Per-source flags: `schedule_enabled` (Rada legacy — deprecated, `_do_rada` is a no-op stub), `schedule_{source}_enabled` for V2 sources. `schedule_hour` key (int, stored as value_text). UI: `/admin/sync` → ScheduleWidget. Endpoints: `GET /admin/sync/status`, `PATCH /admin/sync/settings`.
- Scraper `force=True` mode: bypasses skip logic (re-downloads existing files). Available in `run_scrape_all`, `run_scrape_mod`, `run_scrape_zir`. Trigger via `/admin/v2/scrape/trigger` with `{"force": true}`.
- Scraper pause/resume: JSON state files in `backend/` (`sync_state.json`, `wiki_state.json`, `ccu_state.json`)
- V2 scraper pause/resume: `scrape_v2_{source}_state.json` (per source)
- V2 reindex pause/resume: `reindex_v2_{source}_state.json` (per source, e.g. `reindex_v2_rada_state.json`)
- V1 reindex pause/resume: `reindex_kmu_full_state.json`, `reindex_rada_full_state.json`
- IDs cache: `reindex_kmu_ids_cache.json`, `reindex_rada_ids_cache.json`, `scrape_{source}_ids_cache.json` (TTL 48h)
- Raw law texts (v2): `/root/laws_raw/{source}/{law_id}.txt` + `{law_id}.meta.json`; status: `/root/laws_raw/scrape_status.json`
- Vertex AI initialized ONCE at startup via `_init_vertex_ai()` — do not call `vertexai.init()` per request
- Embeddings v1: Vertex AI `text-embedding-004` (768 dims), max ~20000 tokens per batch call
- Embeddings v2: `gemini-embedding-001` (3072 dims), new SDK `google.genai.Client`, batch=1, SLEEP_SEC=0.1, raises on 3rd failure
- Chunk sizes: Rada 3000/300, KMU 3000/300, CCU/Supreme 3000/300, Wiki/Positions/ZIR 2000/200, MOD 3000/300
- Chunk truncation: always slice `[:8000]` (Rada, Wiki, Positions) or `[:15000]` (KMU, CCU, Supreme, MOD) after title-prefix
- Reindex v2 safe order: embed first → delete old → upload new (prevents data loss on embed failure)
- `upload_to_qdrant()` returns `bool` — always check return value for accurate success counting
- `delete_law_chunks()` retries 3× with exponential backoff — don't call unless certain
- V2 reindex: only ONE source can run at a time (enforced by `_any_reindex_v2_running()` in server.py)
- Metadata enrichment: `enrich_opendata_meta.py` fetches OpenData cards → writes `rada_*` fields to `.meta.json`. State: `enrich_opendata_state.json`. Cache: `enrich_opendata_cards_cache.json` (TTL 7 days). Sources: `["rada", "kmu"]`
- Qdrant metadata patch: `update_qdrant_meta.py` reads `.meta.json` → `set_payload()` on all chunks of the law (filter by `law_id`). State: `update_qdrant_meta_state.json`. No re-embedding.
- Enriched fields in Qdrant payload (after patch): `rada_status`, `rada_status_name`, `rada_is_dead`, `rada_is_dead_by_status`, `rada_is_dead_by_link`, `rada_no_text`, `rada_adopted_date`, `rada_last_edition`, `rada_dead_since`, `rada_replaced_by`, `rada_cancelled_by`, `rada_theme`, `rada_classifiers`, `rada_org`, `rada_doc_type`, etc.
- Dead document detection: `rada_is_dead=True` → excluded from `/ask` results (checked in `_is_expired()` alongside legacy status string check)
- Citation modal (chat): shows enriched metadata (adopted_date, last_edition, dead_since, theme, org, replaced_by links, cancelled_by links) when available
- Enrichment endpoints: `POST /admin/enrich/start`, `POST /admin/enrich/stop`, `GET /admin/enrich/status`, `POST /admin/enrich/qdrant/apply`, `POST /admin/enrich/qdrant/stop`, `GET /admin/meta/list`
- Feedback system: `message_feedback` table (upsert per message per user), `app_reviews` table (full history). `profiles` has `bonus_requests` (additive) + `has_received_review_reward` (one-time flag). RPC `submit_app_review_and_reward(p_rating, p_review_text)` — atomic insert + bonus grant. Reward amount configurable via `app_settings` key `review_reward_requests` (default 50). Trigger threshold: `review_trigger_count` (default 10 total_requests). Endpoints: `POST /api/feedback/message`, `POST /api/feedback/audio`, `POST /api/feedback/review`, `GET/PATCH /api/feedback/review/status`, `GET /api/admin/feedback`. Limit check uses `monthly_limit + bonus_requests`.

## Answer pipeline — scoring constants (server.py)
- `_recency_score()`: вік документа з `_doc_best_date()` (пріоритет: `rada_last_edition` → `effective_date` → `rada_adopted_date` → рік з `law_id`). Бакети penalty для KMU/Rada (не кодекси): `age>=20y → -0.18`, `age>=15y → -0.10`, `age>=10y → -0.05`.
- `_strict_context_score()`: recency weight = **0.40** (не підвищувати — при 0.80 нові але нерелевантні документи витісняють старі але валідні закони).
- `temperature` default = **0.20** (Supabase `app_settings.temperature`). При 0.1 модель копіює фрагменти замість синтезу. Якщо є явне значення в Supabase — воно має пріоритет.
- `_squeeze_context_results()`: кожна категорія джерел має **окремий** cap. `wiki_cap=1` (фоновий контент). `zir_cap=2` (офіційна позиція ДПС). `positions_cap=2` (правові позиції ВС — 12 800 Q&A). `court_cap=max(1,min(2,target//4))` (supreme + CCU + rada_court). `regular_col_cap=max(2,target//3)` (Rada collections + KMU + MOD — не більше 1/3 слотів на одну колекцію). Не об'єднувати назад — кожне джерело має свою природу і cap.
- ASPECT INJECT quality gate: `_extra_prot` docs допускаються тільки якщо їх `coverage >= min(coverage всіх docs у _answ_results)`. Тобто обхід реранкера дозволений лише для документів, що є принаймні такими ж релевантними, як найслабший doc відібраний реранкером. Запобігає ін'єкції старих/маргінальних документів що збіглися по ключових словах аспекту, але не покривають питання.

## Rules: when making changes
- **Architecture changes** → update the Architecture section in this file
- **New admin feature** → add/update the admin panel page AND update the "Admin panel pages" section above
- **New settings key** → add to BOTH `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` AND SQL
- **New scraper** → add state file pattern to Key patterns section above AND add to Data Sources table
- **Admin panel must always reflect the real state of the system** — if a feature exists in backend, it must be visible and controllable from the admin panel

## Don'ts
- Never call `vertexai.init()` inside request handlers — use `_init_vertex_ai()` at startup only
- Never commit `.env` or service account JSON
- Never use `git push --force` on main
- Settings floats stored as `value_text` in Supabase (parsed via `get_float()`)
- New settings keys must be added to BOTH `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` AND inserted into `app_settings` table via SQL
- Never run two v2 reindex processes simultaneously — enforced by backend 409, but don't bypass
- Never reference V1 Qdrant collection names (`rada_finance`, `laws_kmu`, etc.) in new code — all init/search/stats use V2 (`*_v2`) only. `_do_rada` in server.py is a deprecated no-op stub.
- Never ignore return value of `upload_to_qdrant()` — silent False = chunk lost
- Never store zero vectors in Qdrant — embed_v2 raises on failure, caller must handle (skip chunk)
- Never set `limit_reset_at` for FREE plan users — free is a one-time 10-request allowance with no rolling window
- Limit check must always use `monthly_limit + bonus_requests` (not `monthly_limit` alone) — bonus is additive, not separate

## Text Cancellation Mining
- `backend/extract_text_cancellations.py` scans local `/root/laws_raw/{rada,kmu}/*.txt` files for cancellation evidence sections and builds `backend/text_cancellations_cache.json`.
- Runtime state is stored in `backend/text_cancellations_state.json`; backend admin endpoints are `POST /admin/enrich/text/start` and `POST /admin/enrich/text/stop`.
- Admin control and detailed live logs are in `app/admin/meta/page.tsx` alongside OpenData enrichment and Qdrant payload patching.
- New meta/Qdrant fields: `rada_is_dead_by_text`, `rada_cancelled_by_text`, `rada_cancelled_by_text_details`, `rada_text_dead_confidence`, `rada_text_dead_applied_at`.
- Text evidence is monotonic: it may set `rada_is_dead=True`, but enrichment must never downgrade a text-proven dead document back to live.
