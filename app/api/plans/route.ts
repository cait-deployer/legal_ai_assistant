import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// GET /api/plans — public endpoint, returns active plans with benefits
export async function GET() {
  const [plansRes, benefitsRes, featuresRes] = await Promise.all([
    admin()
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
    admin()
      .from("plan_benefits")
      .select("*")
      .order("sort_order"),
    admin()
      .from("plan_features")
      .select("plan_id, feature_key, enabled")
      .eq("enabled", true),
  ])

  const plans = (plansRes.data ?? []).map((plan) => ({
    ...plan,
    benefits: (benefitsRes.data ?? []).filter((b) => b.plan_id === plan.id),
    features: (featuresRes.data ?? [])
      .filter((f) => f.plan_id === plan.id)
      .map((f) => f.feature_key),
  }))

  return NextResponse.json(plans, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  })
}
