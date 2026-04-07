import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

// GET /api/admin/feature-definitions
export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await admin()
    .from("feature_definitions")
    .select("*")
    .order("sort_order")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/admin/feature-definitions — update label/description by key
// Body: { key: string, label?: string, description?: string }
export async function PATCH(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const { key, ...rest } = body

  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ("label" in rest) patch.label = rest.label
  if ("description" in rest) patch.description = rest.description
  if ("category" in rest) patch.category = rest.category

  const { data, error } = await admin()
    .from("feature_definitions")
    .update(patch)
    .eq("key", key)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
