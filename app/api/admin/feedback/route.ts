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
  const cookieStore = await cookies()
  return cookieStore.get("admin_session")?.value === "authenticated"
}

// GET /api/admin/feedback?type=message|review&page=0&limit=50
export async function GET(request: Request) {
  if (!await checkAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const type  = searchParams.get("type") ?? "message"
  const page  = parseInt(searchParams.get("page") ?? "0")
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100)
  const from  = page * limit
  const to    = from + limit - 1

  if (type === "review") {
    const { data, error, count } = await admin()
      .from("app_reviews")
      .select("id, user_id, rating, review_text, created_at, profiles(email, full_name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data, total: count })
  }

  // type === "message"
  const { data, error, count } = await admin()
    .from("message_feedback")
    .select(
      "id, user_id, chat_id, message_id, is_positive, tags, feedback_text, audio_transcription, created_at, updated_at, profiles(email, full_name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, total: count })
}
