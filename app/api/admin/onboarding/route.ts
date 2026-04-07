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

// GET /api/admin/onboarding — всі кроки + опції + статистика відповідей
export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = admin()

  const [stepsRes, optionsRes, responsesRes] = await Promise.all([
    sb.from("onboarding_steps").select("*").order("order_index"),
    sb.from("onboarding_options").select("*").order("order_index"),
    sb.from("onboarding_responses").select("segments,role,sub_role,completed_at").order("completed_at", { ascending: false }).limit(200),
  ])

  return NextResponse.json({
    steps: stepsRes.data ?? [],
    options: optionsRes.data ?? [],
    responses: responsesRes.data ?? [],
  })
}
