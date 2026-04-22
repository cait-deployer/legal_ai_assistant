# Rules for backend/** files

## Vertex AI
- `vertexai.init()` is called ONCE at startup in `_init_vertex_ai()`. NEVER call it inside request handlers or worker threads.
- Embedding model: `text-embedding-004`. Token limit: ~20000 tokens per batch call.
- Always truncate chunks before embedding: `[:8000]` for Rada, `[:15000]` for KMU (after title-prefix).
- EMBED_BATCH=5 for Rada (smaller chunks), EMBED_BATCH=10 for KMU.

## Qdrant
- `upload_to_qdrant()` returns `bool`. Always check: `if ok: uploaded += 1` — never ignore the return value.
- `delete_law_chunks()` has 3× retry built in. Don't wrap it in extra try/except.
- Max 4 concurrent workers to avoid overloading Qdrant. Do NOT increase WORKERS above 4 without testing.
- Never run two reindex processes simultaneously.

## HTTP scraping
- Always retry 3× with `time.sleep(1.5)` between attempts.
- Check for `__RESTRICTED__` sentinel from `get_law_text()` — skip these documents.
- Use `_http_sem = threading.Semaphore(WORKERS)` to limit concurrent HTTP connections.

## Settings
- All app settings live in Supabase `app_settings` table, accessed via `settings_cache.py`.
- Float values stored as `value_text` strings — use `get_float()` helper.
- New settings key → must be added to BOTH `SETTINGS_SCHEMA` (frontend) AND inserted into Supabase via SQL.

## Reindex scripts
- Pause/resume via JSON state files: `*_state.json` in `backend/`.
- IDs cache files: `*_ids_cache.json` (TTL 48h) — don't delete manually during reindex.
- After full reindex completes: run `python repair_missing.py --both` to catch any missed chunks.
- State file is deleted automatically on successful completion — don't delete it manually.

## Thread safety
- Use `threading.Lock()` for shared print (`_print_lock`) and shared counters.
- `_in_progress` sets in scrapers are protected by Lock — always acquire before mutating.
- `ThreadPoolExecutor` contexts should be short-lived per batch, not one long-lived executor.

## FastAPI endpoints
- New endpoint → add matching Next.js API route in `app/api/admin/`.
- If endpoint controls a feature visible to the admin, update the admin panel page too.
- Never block the event loop — use `asyncio.to_thread()` for CPU-bound or blocking I/O.
