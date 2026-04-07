import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { invalidatePlanCache } from "@/lib/permissions"

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

// PUT /api/admin/plans/[id]/features
// Body: { features: { [feature_key]: boolean } }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: planId } = await params
  const { features } = await request.json() as { features: Record<string, boolean> }

  // Upsert each feature toggle
  const rows = Object.entries(features).map(([feature_key, enabled]) => ({
    plan_id: planId,
    feature_key,
    enabled,
  }))

  const { error } = await admin()
    .from("plan_features")
    .upsert(rows, { onConflict: "plan_id,feature_key" })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalidate permission cache so changes take effect immediately
  invalidatePlanCache(planId)

  return NextResponse.json({ ok: true })
}
