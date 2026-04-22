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

## Admin panel pages (app/admin/)
Every admin page must stay accurate. When you add/change backend functionality, update the matching admin page:
- `app/admin/reindex/page.tsx` — Reindex control (KMU + Rada panels, start/stop/resume)
- `app/admin/ai-settings/page.tsx` — AI model settings, thresholds
- `app/admin/scraper/page.tsx` — Scraper control panel
- `app/admin/coverage/page.tsx` — Collection coverage stats
- `app/admin/stats/page.tsx` — System stats / usage

## Key patterns
- Settings (AI model, thresholds) — Supabase `app_settings` table, read via `settings_cache`
- All Qdrant collections: `RADA_COLLECTIONS` (12) + `laws_supreme`, `laws_wiki`, `laws_ccu`, `laws_kmu`
- `/ask` endpoint: embed → parallel Qdrant search → boost Rada scores → Gemini
- Scraper pause/resume: JSON state files in `backend/` (`sync_state.json`, `wiki_state.json`, `ccu_state.json`)
- Reindex pause/resume: JSON state files (`reindex_kmu_full_state.json`, `reindex_rada_full_state.json`)
- IDs cache: `reindex_kmu_ids_cache.json`, `reindex_rada_ids_cache.json` (TTL 48h)
- Vertex AI initialized ONCE at startup via `_init_vertex_ai()` — do not call `vertexai.init()` per request
- Embeddings: Vertex AI `text-embedding-004`, max ~20000 tokens per batch call
- Chunk sizes: Rada 3000 chars / overlap 300, KMU 4000 chars / overlap 400
- Chunk truncation: always slice `[:8000]` (Rada) or `[:15000]` (KMU) after title-prefix
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
