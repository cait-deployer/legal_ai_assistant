import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/settings/session
// Called when user leaves the chat page. Updates rolling avg_session_duration.
// Body: { duration_seconds: number }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const duration: number = Math.round(Number(body.duration_seconds ?? 0))

  // Ignore sessions under 5s (tab switch, accidental opens) or over 4h
  if (duration < 5 || duration > 14400) return NextResponse.json({ ok: false, reason: "out_of_range" })

  const { data: profile } = await admin()
    .from("profiles")
    .select("avg_session_duration, session_count")
    .eq("id", user.id)
    .single()

  if (!profile) return NextResponse.json({ ok: false })

  const n = profile.session_count ?? 0
  const oldAvg = profile.avg_session_duration ?? 0
  // Rolling average: avg_new = (avg_old * n + new) / (n + 1)
  const newAvg = Math.round((oldAvg * n + duration) / (n + 1))

  await admin().from("profiles").update({
    avg_session_duration: newAvg,
    session_count: n + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id)

  return NextResponse.json({ ok: true, avg_session_duration: newAvg })
}
