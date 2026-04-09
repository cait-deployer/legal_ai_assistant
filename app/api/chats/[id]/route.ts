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
    .single()
  return !!data
}

// GET /api/chats/[id] — get messages for a chat
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getVerifiedUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await chatBelongsToUser(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { data, error } = await admin()
    .from("messages")
    .select("id, role, content, citations, created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/chats/[id] — delete a chat (cascade deletes messages)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getVerifiedUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await chatBelongsToUser(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const { error } = await admin().from("chats").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
