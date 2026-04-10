import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

const BACKEND = process.env.API_URL || "http://localhost:8000"

// All settings managed via admin panel
const SETTINGS_SCHEMA: Record<string, { type: "text" | "float" | "bool"; default: string | number | boolean; secret?: boolean }> = {
  service_account_json:  { type: "text",  default: "",                   secret: true },
  vertex_location:       { type: "text",  default: "us-central1" },
  ai_model:              { type: "text",  default: "gemini-2.0-flash-lite" },
  embedding_model:       { type: "text",  default: "text-embedding-004" },
  system_prompt:         { type: "text",  default: "Ти — досвідчений український адвокат." },
  temperature:           { type: "float", default: 0.1 },
  top_p:                 { type: "float", default: 0.8 },
  match_threshold_docs:  { type: "float", default: 0.4 },
  min_relevance_score:   { type: "float", default: 0.28 },
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = admin()
  const { data, error } = await sb.from("app_settings").select("key,value_text,value_int,value_bool")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result: Record<string, string | number | boolean> = {}
  for (const [key, meta] of Object.entries(SETTINGS_SCHEMA)) {
    result[key] = meta.default
  }
  for (const row of data ?? []) {
    if (!(row.key in SETTINGS_SCHEMA)) continue
    const meta = SETTINGS_SCHEMA[row.key]
    if (meta.type === "bool" && row.value_bool !== null) result[row.key] = row.value_bool
    else if (meta.type === "float" && row.value_text !== null) result[row.key] = parseFloat(row.value_text)
    else if (meta.type === "text" && row.value_text !== null) result[row.key] = row.value_text
  }

  return NextResponse.json(result)
}

export async function PATCH(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json() as Record<string, string | number | boolean>
  const sb = admin()

  const upserts = []
  for (const [key, value] of Object.entries(body)) {
    if (!(key in SETTINGS_SCHEMA)) continue
    const meta = SETTINGS_SCHEMA[key]
    const row: Record<string, unknown> = { key }
    if (meta.type === "bool") {
      row.value_bool = Boolean(value)
      row.value_text = null
      row.value_int  = null
    } else {
      row.value_text = String(value)
      row.value_bool = null
      row.value_int  = null
    }
    upserts.push(row)
  }

  if (upserts.length === 0) return NextResponse.json({ ok: true })

  const { error } = await sb.from("app_settings").upsert(upserts, { onConflict: "key" })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Повідомляємо бекенд перезавантажити кеш
  try {
    await fetch(`${BACKEND}/admin/settings/refresh`, { method: "POST" })
  } catch {
    // не критично — бекенд підхопить при наступному перезапуску
  }

  return NextResponse.json({ ok: true })
}
