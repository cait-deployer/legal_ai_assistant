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

  // Read review timing/reward settings from app_settings
  const { data: settings } = await admin()
    .from("app_settings")
    .select("key,value_int")
    .in("key", ["review_first_message_count", "review_repeat_message_count", "review_bonus_requests"])

  const settingMap = new Map((settings ?? []).map(row => [row.key, row.value_int]))
  const triggerCount = Math.max(1, settingMap.get("review_first_message_count") ?? 1)
  const repeatMessageCount = Math.max(1, settingMap.get("review_repeat_message_count") ?? 5)
  const rewardAmount = Math.max(0, settingMap.get("review_bonus_requests") ?? 5)

  // Read user profile fields we need
  const { data: profile } = await admin()
    .from("profiles")
    .select("total_requests, has_received_review_reward, review_prompted_at")
    .eq("id", user.id)
    .single()

  if (!profile) return NextResponse.json({ show: false })

  const totalReqs: number = profile.total_requests ?? 0
  const alreadyRewarded: boolean = profile.has_received_review_reward ?? false

  // Show prompt when user reaches threshold AND hasn't reviewed yet.
  // Client stores "later" message count and repeats after review_repeat_message_count.
  const shouldShow = totalReqs >= triggerCount && !alreadyRewarded

  return NextResponse.json({
    show:            shouldShow,
    total_requests:  totalReqs,
    reward_eligible: !alreadyRewarded,
    trigger_count:   triggerCount,
    repeat_message_count: repeatMessageCount,
    reward_amount: rewardAmount,
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
