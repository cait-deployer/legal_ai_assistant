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

// PATCH /api/admin/plans/benefits/[benefitId] — edit text or category
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ benefitId: string }> }
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { benefitId } = await params
  const body = await request.json()

  const patch: Record<string, unknown> = {}
  if ("text" in body) patch.text = body.text
  if ("category" in body) patch.category = body.category

  const { data, error } = await admin()
    .from("plan_benefits")
    .update(patch)
    .eq("id", Number(benefitId))
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/admin/plans/benefits/[benefitId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ benefitId: string }> }
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { benefitId } = await params

  const { error } = await admin()
    .from("plan_benefits")
    .delete()
    .eq("id", Number(benefitId))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
