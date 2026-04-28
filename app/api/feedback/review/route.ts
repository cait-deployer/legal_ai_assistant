import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// POST /api/feedback/review — submit app review, award bonus once via RPC
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json() as { rating: number; review_text: string }
  const { rating, review_text } = body

  if (!rating || !review_text) {
    return NextResponse.json({ error: "rating and review_text required" }, { status: 400 })
  }

  // RPC runs in a single transaction: inserts review + awards bonus (once)
  const { data, error } = await supabase.rpc("submit_app_review_and_reward", {
    p_rating:      rating,
    p_review_text: review_text,
  })

  if (error) {
    // Surface validation errors (text too short, rating out of range) as 400
    if (error.message.includes("too short") || error.message.includes("between 1 and 5")) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
