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

// GET /api/admin/plans — all plans with features + benefits
export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [plansRes, featuresRes, benefitsRes, defsRes] = await Promise.all([
    admin().from("subscription_plans").select("*").order("sort_order"),
    admin().from("plan_features").select("plan_id, feature_key, enabled"),
    admin().from("plan_benefits").select("*").order("sort_order"),
    admin().from("feature_definitions").select("*").order("sort_order"),
  ])

  return NextResponse.json({
    plans: plansRes.data ?? [],
    features: featuresRes.data ?? [],
    benefits: benefitsRes.data ?? [],
    definitions: defsRes.data ?? [],
  })
}

// PATCH /api/admin/plans — reorder (sort_order)
export async function PATCH(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { order } = await request.json() // [{ id, sort_order }]
  if (!Array.isArray(order)) return NextResponse.json({ error: "Invalid" }, { status: 400 })

  await Promise.all(
    order.map(({ id, sort_order }: { id: string; sort_order: number }) =>
      admin().from("subscription_plans").update({ sort_order }).eq("id", id)
    )
  )

  return NextResponse.json({ ok: true })
}
