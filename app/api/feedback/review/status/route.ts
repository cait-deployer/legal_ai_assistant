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

// GET /api/feedback/review/status
// Returns whether the review modal should be shown and reward eligibility
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Read trigger threshold from app_settings
  const { data: setting } = await admin()
    .from("app_settings")
    .select("value_int")
    .eq("key", "review_trigger_count")
    .single()
  const triggerCount: number = setting?.value_int ?? 10

  // Read user profile fields we need
  const { data: profile } = await admin()
    .from("profiles")
    .select("total_requests, has_received_review_reward, review_prompted_at")
    .eq("id", user.id)
    .single()

  if (!profile) return NextResponse.json({ show: false })

  const totalReqs: number = profile.total_requests ?? 0
  const alreadyRewarded: boolean = profile.has_received_review_reward ?? false

  // Show modal once: when user reaches threshold AND hasn't reviewed yet
  const shouldShow = totalReqs >= triggerCount && !alreadyRewarded

  // Avoid spam: don't re-show within 24h if dismissed without submitting
  const lastPromptedAt = profile.review_prompted_at ? new Date(profile.review_prompted_at) : null
  const recentlyPrompted = lastPromptedAt
    ? Date.now() - lastPromptedAt.getTime() < 24 * 60 * 60 * 1000
    : false

  return NextResponse.json({
    show:            shouldShow && !recentlyPrompted,
    total_requests:  totalReqs,
    reward_eligible: !alreadyRewarded,
    trigger_count:   triggerCount,
  })
}

// PATCH /api/feedback/review/status — mark that we showed the modal (update review_prompted_at)
export async function PATCH() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await admin()
    .from("profiles")
    .update({ review_prompted_at: new Date().toISOString() })
    .eq("id", user.id)

  return NextResponse.json({ ok: true })
}
