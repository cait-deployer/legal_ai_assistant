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

async function getVerifiedUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function chatBelongsToUser(chatId: string, userId: string): Promise<boolean> {
  const { data } = await admin()
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .single()
  return !!data
}

// GET /api/chats/[id] — get messages + context_summary for a chat
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getVerifiedUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Fetch chat metadata (ownership check + context_summary)
  const { data: chat } = await admin()
    .from("chats")
    .select("id, context_summary, deleted_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single()

  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: messages, error } = await admin()
    .from("messages")
    .select("id, role, content, citations, created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages, context_summary: chat.context_summary ?? null })
}

// DELETE /api/chats/[id] — hide a chat for the user, keep messages for analytics/eval
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getVerifiedUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await chatBelongsToUser(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await admin()
    .from("chats")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user: true,
    })
    .eq("id", id)
    .eq("user_id", user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
