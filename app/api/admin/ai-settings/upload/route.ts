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

const REQUIRED_SA_FIELDS = ["type", "project_id", "private_key", "client_email"]

export async function POST(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let saJson: Record<string, unknown>
  const contentType = request.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData()
    const file = form.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    const text = await file.text()
    try {
      saJson = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: "Invalid JSON file" }, { status: 400 })
    }
  } else {
    // Accept raw JSON body too
    try {
      saJson = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
  }

  // Validate required fields
  for (const field of REQUIRED_SA_FIELDS) {
    if (!saJson[field]) {
      return NextResponse.json(
        { error: `Missing field in service account JSON: ${field}` },
        { status: 400 }
      )
    }
  }

  if (saJson.type !== "service_account") {
    return NextResponse.json(
      { error: 'Invalid JSON: "type" must be "service_account"' },
      { status: 400 }
    )
  }

  const jsonString = JSON.stringify(saJson)
  const sb = admin()
  const { error } = await sb.from("app_settings").upsert(
    {
      key: "service_account_json",
      value_text: jsonString,
      value_bool: null,
      value_int: null,
    },
    { onConflict: "key" }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Refresh backend cache
  try {
    await fetch(`${BACKEND}/admin/settings/refresh`, { method: "POST" })
  } catch {
    // not critical
  }

  return NextResponse.json({
    ok: true,
    project_id: saJson.project_id as string,
    client_email: saJson.client_email as string,
  })
}
