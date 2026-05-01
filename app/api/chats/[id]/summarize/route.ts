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

const BACKEND_URL = process.env.API_URL ?? "http://localhost:8001"
// Keep last N messages unsummarized (= last 1 turn), the AI also sees last 6 via body.history
const KEEP_LAST_N = 2

// POST /api/chats/[id]/summarize
// Reads all messages, summarizes everything except last 6, saves to chats.context_summary
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Verify ownership + get existing summary
  const { data: chat } = await admin()
    .from("chats")
    .select("id, context_summary")
    .eq("id", chatId)
    .eq("user_id", user.id)
    .single()

  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Fetch all messages for this chat
  const { data: allMessages, error: msgError } = await admin()
    .from("messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })

  if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 })
  if (!allMessages || allMessages.length <= KEEP_LAST_N) {
    // Not enough messages to summarize yet
    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      summary: chat.context_summary ?? null,
      skipped: true,
      reason: "not_enough_messages",
      messages_count: allMessages?.length ?? 0,
      summarized_count: 0,
      persisted: Boolean(chat.context_summary),
      summary_len: chat.context_summary?.length ?? 0,
    })
  }

  const lastMessage = allMessages[allMessages.length - 1]
  if (allMessages.length % 2 !== 0 || lastMessage.role !== "assistant") {
    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      summary: chat.context_summary ?? null,
      skipped: true,
      reason: "waiting_for_complete_turn",
      messages_count: allMessages.length,
      summarized_count: 0,
      persisted: Boolean(chat.context_summary),
      summary_len: chat.context_summary?.length ?? 0,
    })
  }

  // Messages to summarize = everything except the last KEEP_LAST_N
  const toSummarize = allMessages.slice(0, allMessages.length - KEEP_LAST_N)
  const messages = toSummarize.map(m => ({ role: m.role, content: m.content }))

  // Call FastAPI summarize endpoint
  const backendRes = await fetch(`${BACKEND_URL}/summarize_history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      existing_summary: chat.context_summary ?? null,
    }),
    signal: AbortSignal.timeout(25_000),
  })

  if (!backendRes.ok) {
    const err = await backendRes.text().catch(() => "backend error")
    return NextResponse.json({ error: err }, { status: 502 })
  }

  const { summary } = await backendRes.json() as { summary: string }
  if (!summary) return NextResponse.json({ error: "empty summary" }, { status: 500 })

  // Save to chats table and verify the write, otherwise the UI may think
  // summary exists while chats.context_summary remains NULL.
  const { error: updateError } = await admin()
    .from("chats")
    .update({ context_summary: summary, updated_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("user_id", user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const { data: savedChat, error: readBackError } = await admin()
    .from("chats")
    .select("id, context_summary")
    .eq("id", chatId)
    .eq("user_id", user.id)
    .single()

  if (readBackError) {
    return NextResponse.json({ error: readBackError.message }, { status: 500 })
  }

  const persisted = savedChat?.context_summary === summary
  if (!persisted) {
    return NextResponse.json({
      error: "summary was generated but not persisted",
      chat_id: chatId,
      messages_count: allMessages.length,
      summarized_count: messages.length,
      persisted: false,
      summary_len: summary.length,
      saved_summary_len: savedChat?.context_summary?.length ?? 0,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    chat_id: chatId,
    summary: savedChat.context_summary,
    messages_count: allMessages.length,
    summarized_count: messages.length,
    persisted: true,
    summary_len: savedChat.context_summary.length,
  })
}
