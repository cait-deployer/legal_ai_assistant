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

async function readIntSetting(key: string, fallback: number) {
  const { data } = await admin()
    .from("app_settings")
    .select("value_int")
    .eq("key", key)
    .single()

  return typeof data?.value_int === "number" ? data.value_int : fallback
}

// POST /api/feedback/review - submit app review, award bonus once
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json() as { rating: number; review_text: string }
  const rating = Number(body.rating)
  const reviewText = (body.review_text ?? "").trim()

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be between 1 and 5" }, { status: 400 })
  }

  const minLength = Math.max(0, await readIntSetting("review_min_text_length", 20))
  if (reviewText.length < minLength) {
    return NextResponse.json({ error: `review_text too short (min ${minLength} chars)` }, { status: 400 })
  }

  const sb = admin()
  const { error: insertError } = await sb
    .from("app_reviews")
    .insert({ user_id: user.id, rating, review_text: reviewText })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("bonus_requests, has_received_review_reward")
    .eq("id", user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: profileError?.message ?? "profile not found" }, { status: 500 })
  }

  let rewarded = false
  let bonusAdded = 0
  if (!profile.has_received_review_reward) {
    const rewardAmount = Math.max(0, await readIntSetting("review_bonus_requests", 5))
    const { error: rewardError } = await sb
      .from("profiles")
      .update({
        bonus_requests: (profile.bonus_requests ?? 0) + rewardAmount,
        has_received_review_reward: true,
      })
      .eq("id", user.id)
      .eq("has_received_review_reward", false)

    if (rewardError) {
      return NextResponse.json({ error: rewardError.message }, { status: 500 })
    }
    rewarded = rewardAmount > 0
    bonusAdded = rewardAmount
  }

  return NextResponse.json({ rewarded, bonus_added: bonusAdded })
}
