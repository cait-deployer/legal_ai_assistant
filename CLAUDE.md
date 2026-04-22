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
- `backend/qdrant_storage.py` — Qdrant vector DB interface (15 collections)
- `backend/rada_scanner.py` — Rada law scraper + `get_all_legal_ids()`, `get_law_text()`, `get_law_metadata()`
- `backend/kmu_scanner.py` — KMU law scraper + `get_all_kmu_docs()`
- `backend/ccu_scanner.py` — Constitutional Court scraper
- `backend/settings_cache.py` — Settings from Supabase (cached in memory)
- `backend/rada_to_supabase.py` — LangChain embeddings helper (Vertex AI `text-embedding-004`)
- `backend/reindex_rada_full.py` — Full reindex of all 12 rada_* collections
- `backend/reindex_kmu_full.py` — Full reindex of laws_kmu collection
- `backend/repair_missing.py` — Targeted repair: re-indexes only laws missing from Qdrant
- `backend/embed_v2.py` — Embedding module v2: `gemini-embedding-001` (3072 dims), lazy init, thread-safe
- `backend/scrape_all_v2.py` — "Last scraper ever": saves all raw texts to `/root/laws_raw/` (all 5 sources), pause/resume
- `backend/reindex_v2.py` — Reads from disk, chunks, embeds with embed_v2, uploads to `*_v2` Qdrant collections

## Admin panel pages (app/admin/)
Every admin page must stay accurate. When you add/change backend functionality, update the matching admin page:
- `app/admin/reindex/page.tsx` — Reindex control (KMU + Rada panels, start/stop/resume)
- `app/admin/ai-settings/page.tsx` — AI model settings, thresholds
- `app/admin/scraper/page.tsx` — Scraper control panel
- `app/admin/coverage/page.tsx` — Collection coverage stats
- `app/admin/stats/page.tsx` — System stats / usage

## Key patterns
- Settings (AI model, thresholds) — Supabase `app_settings` table, read via `settings_cache`
- All Qdrant collections: `RADA_COLLECTIONS` (13) + `laws_supreme`, `laws_wiki`, `laws_ccu`, `laws_positions`, `laws_kmu` (v1, 768 dims)
- V2 Qdrant collections: same names with `_v2` suffix (17 collections, 3072 dims) — shadow, not yet live in production
- `/ask` endpoint: embed → parallel Qdrant search → boost Rada scores → Gemini
- Scraper pause/resume: JSON state files in `backend/` (`sync_state.json`, `wiki_state.json`, `ccu_state.json`)
- Reindex pause/resume: JSON state files (`reindex_kmu_full_state.json`, `reindex_rada_full_state.json`, `reindex_v2_state.json`, `scrape_all_v2_state.json`)
- IDs cache: `reindex_kmu_ids_cache.json`, `reindex_rada_ids_cache.json`, `scrape_{source}_ids_cache.json` (TTL 48h)
- Raw law texts (v2): `/root/laws_raw/{source}/{law_id}.txt` + `{law_id}.meta.json`; status: `/root/laws_raw/scrape_status.json`
- Vertex AI initialized ONCE at startup via `_init_vertex_ai()` — do not call `vertexai.init()` per request
- Embeddings v1: Vertex AI `text-embedding-004` (768 dims), max ~20000 tokens per batch call
- Embeddings v2: `gemini-embedding-001` (3072 dims), new SDK `google.genai.Client`, batch=1, SLEEP_SEC=0.1
- Chunk sizes: Rada 3000/300, KMU 4000/400, CCU/Supreme 3000/300, Wiki 2000/200
- Chunk truncation: always slice `[:8000]` (Rada, Wiki) or `[:15000]` (KMU, CCU, Supreme) after title-prefix
- `upload_to_qdrant()` returns `bool` — always check return value for accurate success counting
- `delete_law_chunks()` retries 3× with exponential backoff — don't call unless certain

## Rules: when making changes
- **Architecture changes** → update the Architecture section in this file
- **New admin feature** → add/update the admin panel page AND update the "Admin panel pages" section above
- **New settings key** → add to BOTH `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` AND SQL
- **New scraper** → add state file pattern to Key patterns section above
- **Admin panel must always reflect the real state of the system** — if a feature exists in backend, it must be visible and controllable from the admin panel

## Don'ts
- Never call `vertexai.init()` inside request handlers — use `_init_vertex_ai()` at startup only
- Never commit `.env` or service account JSON
- Never use `git push --force` on main
- Settings floats stored as `value_text` in Supabase (parsed via `get_float()`)
- New settings keys must be added to BOTH `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` AND inserted into `app_settings` table via SQL
- Never run two reindex processes simultaneously — Qdrant will be overloaded (reduce to 4 workers max)
- Never ignore return value of `upload_to_qdrant()` — silent False = chunk lost
