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

// POST /api/admin/onboarding/options — створити новий варіант
export async function POST(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json() as {
    step_key: string; value: string; label: string
    description?: string; icon?: string; parent_value?: string; order_index?: number
  }

  const sb = admin()
  const { data, error } = await sb.from("onboarding_options").insert({
    step_key: body.step_key,
    value: body.value,
    label: body.label,
    description: body.description ?? null,
    icon: body.icon ?? null,
    parent_value: body.parent_value ?? null,
    order_index: body.order_index ?? 0,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/admin/onboarding/options — оновити варіант (передаємо id + поля)
export async function PATCH(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id, ...fields } = await request.json() as { id: string; [k: string]: unknown }

  const allowed = ["label", "description", "icon", "parent_value", "order_index", "is_active"]
  const patch: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in fields) patch[k] = fields[k]
  }

  const sb = admin()
  const { data, error } = await sb.from("onboarding_options").update(patch).eq("id", id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/admin/onboarding/options?id=xxx
export async function DELETE(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  const sb = admin()
  const { error } = await sb.from("onboarding_options").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
