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
- `backend/rada_scanner.py` — Rada law scraper
- `backend/ccu_scanner.py` — Constitutional Court scraper
- `backend/settings_cache.py` — Settings from Supabase (cached in memory)
- `backend/rada_to_supabase.py` — LangChain embeddings helper

## Key patterns
- Settings (AI model, thresholds) — Supabase `app_settings` table, read via `settings_cache`
- All Qdrant collections: `RADA_COLLECTIONS` (12) + `laws_supreme`, `laws_wiki`, `laws_ccu`
- `/ask` endpoint: embed → parallel Qdrant search → boost Rada scores → Gemini
- Scraper pause/resume: JSON state files in `backend/` (`sync_state.json`, `wiki_state.json`, `ccu_state.json`)
- Vertex AI initialized ONCE at startup via `_init_vertex_ai()` — do not call `vertexai.init()` per request

## Don'ts
- Never call `vertexai.init()` inside request handlers — use `_init_vertex_ai()` at startup only
- Never commit `.env` or service account JSON
- Never use `git push --force` on main
- Settings floats stored as `value_text` in Supabase (parsed via `get_float()`)
- New settings keys must be added to BOTH `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` AND inserted into `app_settings` table via SQL
