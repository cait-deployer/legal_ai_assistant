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

// GET /api/admin/feedback/detail?message_id=uuid
// Returns the AI message + the preceding user question from the same chat
export async function GET(request: Request) {
  if (!await checkAdmin()) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get("message_id")
  if (!messageId) return NextResponse.json({ error: "message_id required" }, { status: 400 })

  // Fetch the AI message
  const { data: aiMsg, error: msgErr } = await admin()
    .from("messages")
    .select("id, chat_id, role, content, created_at")
    .eq("id", messageId)
    .single()

  if (msgErr || !aiMsg) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }

  // Fetch the preceding user message in the same chat
  const { data: userMsg } = await admin()
    .from("messages")
    .select("id, role, content, created_at")
    .eq("chat_id", aiMsg.chat_id)
    .eq("role", "user")
    .lt("created_at", aiMsg.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json({
    ai_message:   aiMsg,
    user_message: userMsg ?? null,
  })
}
