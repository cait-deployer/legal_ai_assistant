# Rules for app/** files

## Admin panel — the golden rule
The admin panel must always reflect the real state of the system.
- If a feature exists in backend → it must be visible and controllable from the admin panel.
- If you change backend behavior (new params, new endpoints, new timings) → update the matching admin page.
- If you add a new backend feature → add an admin panel page for it.

## Admin pages location
All admin pages live in `app/admin/`. Matching API routes in `app/api/admin/`.
- `reindex/page.tsx` — reindex control (KMU + Rada, start/stop/resume/logs)
- `ai-settings/page.tsx` — AI model, thresholds, Supabase settings
- `scraper/page.tsx` — scraper control
- `coverage/page.tsx` — Qdrant collection coverage stats
- `stats/page.tsx` — usage stats

## API routes
- All admin API routes proxy to FastAPI backend at port 8001.
- Route pattern: `app/api/admin/<feature>/route.ts`
- Always handle errors: return `{ error }` with appropriate status code.
- Never hardcode backend URL — use env var or relative proxy config.

## Settings schema
- `SETTINGS_SCHEMA` in `app/api/admin/ai-settings/route.ts` defines all available settings.
- New setting → add to schema AND insert into Supabase `app_settings` via SQL.
- Float values come back as strings from Supabase — the schema handles parsing.

## UI conventions
- Color palette: `#0A0E1A` background, `#C9A84C` gold accent, `#E0E6ED` text.
- Status badges: emerald = success/running, amber = warning/pending, red = error.
- Logs panel: monospace, `h-56 overflow-y-auto`, auto-scroll to bottom.
- Polling interval: 5000ms when running, stop polling when not running.
- All Ukrainian text in UI — labels, descriptions, status messages.

## TypeScript
- Use strict types for all API response shapes (`type PanelState = {...}`).
- `"use client"` directive required for any component using `useState`/`useEffect`.
- Never use `any` — define the type or use `unknown` with a type guard.
