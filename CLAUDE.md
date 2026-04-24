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
- `backend/qdrant_storage.py` — Qdrant vector DB interface (17 v2 collections + 15 v1 collections)
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
- `backend/reindex_v2.py` — Reads from disk, chunks, embeds with embed_v2, uploads to `*_v2` Qdrant collections. Safe order: embed first → delete old → upload. Per-source state files.

## Data Sources (6 sources scraped to /root/laws_raw/)

| Source | Site | Що містить | Розмір | Навіщо |
|--------|------|-----------|--------|--------|
| `rada` | zakon.rada.gov.ua | Всі закони, кодекси, постанови ВР України | ~15 500 doc | Основа: первинне законодавство |
| `kmu` | kmu.gov.ua / zakon.rada.gov.ua | Постанови, розпорядження, накази КМУ | ~10 000+ doc | Підзаконні акти виконавчої влади |
| `ccu` | ccu.gov.ua | Рішення і висновки Конституційного суду | ~300–500 doc | Тлумачення Конституції, скасування норм |
| `supreme` | reyestr.court.gov.ua | Постанови пленуму ВС, узагальнення судової практики | ~1 000+ doc | Офіційна судова практика |
| `wiki` | uk.wikipedia.org | Юридичні терміни, визначення правових понять | ~кілька тис. | Пояснення термінів для бота |
| `positions` | lpd.court.gov.ua | Правові позиції Верховного суду по категоріях справ | ~12 800 doc | Конкретні позиції ВС — найточніші відповіді |

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

## Key patterns
- Settings (AI model, thresholds) — Supabase `app_settings` table, read via `settings_cache`
- All Qdrant collections v1: `RADA_COLLECTIONS` (13) + `laws_supreme`, `laws_wiki`, `laws_ccu`, `laws_positions`, `laws_kmu` (768 dims)
- V2 Qdrant collections: same names with `_v2` suffix (17 collections, 3072 dims) — shadow, not yet live in production
- `/ask` endpoint: embed → parallel Qdrant search → boost Rada scores → Gemini
- Scraper pause/resume: JSON state files in `backend/` (`sync_state.json`, `wiki_state.json`, `ccu_state.json`)
- V2 scraper pause/resume: `scrape_v2_{source}_state.json` (per source)
- V2 reindex pause/resume: `reindex_v2_{source}_state.json` (per source, e.g. `reindex_v2_rada_state.json`)
- V1 reindex pause/resume: `reindex_kmu_full_state.json`, `reindex_rada_full_state.json`
- IDs cache: `reindex_kmu_ids_cache.json`, `reindex_rada_ids_cache.json`, `scrape_{source}_ids_cache.json` (TTL 48h)
- Raw law texts (v2): `/root/laws_raw/{source}/{law_id}.txt` + `{law_id}.meta.json`; status: `/root/laws_raw/scrape_status.json`
- Vertex AI initialized ONCE at startup via `_init_vertex_ai()` — do not call `vertexai.init()` per request
- Embeddings v1: Vertex AI `text-embedding-004` (768 dims), max ~20000 tokens per batch call
- Embeddings v2: `gemini-embedding-001` (3072 dims), new SDK `google.genai.Client`, batch=1, SLEEP_SEC=0.1, raises on 3rd failure
- Chunk sizes: Rada 3000/300, KMU 4000/400, CCU/Supreme 3000/300, Wiki/Positions 2000/200
- Chunk truncation: always slice `[:8000]` (Rada, Wiki, Positions) or `[:15000]` (KMU, CCU, Supreme) after title-prefix
- Reindex v2 safe order: embed first → delete old → upload new (prevents data loss on embed failure)
- `upload_to_qdrant()` returns `bool` — always check return value for accurate success counting
- `delete_law_chunks()` retries 3× with exponential backoff — don't call unless certain
- V2 reindex: only ONE source can run at a time (enforced by `_any_reindex_v2_running()` in server.py)

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
- Never ignore return value of `upload_to_qdrant()` — silent False = chunk lost
- Never store zero vectors in Qdrant — embed_v2 raises on failure, caller must handle (skip chunk)
