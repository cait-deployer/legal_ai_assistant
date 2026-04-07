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

// PATCH /api/admin/plans/benefits/reorder
// Body: { order: [{ id: number, sort_order: number }] }
export async function PATCH(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { order } = await request.json()
  if (!Array.isArray(order)) return NextResponse.json({ error: "Invalid" }, { status: 400 })

  await Promise.all(
    order.map(({ id, sort_order }: { id: number; sort_order: number }) =>
      admin().from("plan_benefits").update({ sort_order }).eq("id", id)
    )
  )

  return NextResponse.json({ ok: true })
}
