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

function extractIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? null
}

// POST /api/chats/[id]/messages — save a message + optional analytics row
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const clientIp = extractIp(request)
  const body = await request.json()
  const { role, content, references, analytics } = body as {
    role: "user" | "assistant"
    content: string
    references?: unknown[]
    analytics?: {
      query_text: string
      ai_response: string
      category?: string
      sentiment?: string
      complexity_score?: number
      user_intent?: string
      processing_time_ms?: number
      tokens_used?: number
    }
  }

  if (!role || !content) {
    return NextResponse.json({ error: "role and content required" }, { status: 400 })
  }

  // Verify chat ownership
  const { data: chat } = await admin()
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", user.id)
    .single()

  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Always save messages to DB (history in UI is controlled by plan, but we store for analytics)
  const { data: savedMsg, error: msgError } = await admin()
    .from("messages")
    .insert({ chat_id: chatId, role, content, references: references ?? [] })
    .select()
    .single()

  if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 })
  const message = savedMsg

  // Update chat's updated_at so it bubbles to top of sidebar
  await admin()
    .from("chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId)

  // When the AI responds: increment usage counter + save analytics
  if (role === "assistant") {
    // Increment requests_this_month with 30-day rolling window
    const { data: usageProfile } = await admin()
      .from("profiles")
      .select("requests_this_month, total_requests, limit_reset_at, monthly_limit")
      .eq("id", user.id)
      .single()

    if (usageProfile) {
      const profile = usageProfile
      const now = new Date()
      let count: number = profile.requests_this_month ?? 0
      let newResetAt: string | null = null
      const isFirstRequest = (profile.total_requests ?? 0) === 0

      // Check if 30-day window has expired
      if (profile.limit_reset_at) {
        const resetAt = new Date(profile.limit_reset_at)
        if (now >= resetAt) {
          // Window expired — start new 30-day window
          count = 0
          newResetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      } else {
        // First ever request — open first window
        newResetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }

      const usageUpdate: Record<string, unknown> = {
        requests_this_month: count + 1,
        total_requests: (profile.total_requests ?? 0) + 1,
        last_active_at: now.toISOString(),
        updated_at: now.toISOString(),
      }
      if (newResetAt) usageUpdate.limit_reset_at = newResetAt
      // Mark trial as used on first ever AI interaction
      if (isFirstRequest) usageUpdate.trial_used = true

      await admin().from("profiles").update(usageUpdate).eq("id", user.id)
    }

    // Save analytics row
    if (analytics) {
      await admin().from("query_analytics").insert({
        user_id:            user.id,
        chat_id:            chatId,
        query_text:         analytics.query_text,
        ai_response:        analytics.ai_response,
        category:           analytics.category ?? null,
        sentiment:          analytics.sentiment ?? null,
        complexity_score:   analytics.complexity_score ?? null,
        user_intent:        analytics.user_intent ?? null,
        processing_time_ms: analytics.processing_time_ms ?? null,
        tokens_used:        analytics.tokens_used ?? 0,
        user_ip:            clientIp,   // read from server headers, not from client body
      })
    }
  }

  return NextResponse.json(message)
}
