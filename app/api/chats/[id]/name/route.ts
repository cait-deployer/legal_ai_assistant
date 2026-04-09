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

// PATCH /api/chats/[id]/name — AI auto-names the chat after first exchange
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: chatId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { question, answer } = await request.json()
  if (!question || !answer) {
    return NextResponse.json({ error: "question and answer required" }, { status: 400 })
  }

  const backendUrl = process.env.API_URL ?? "http://localhost:8000"

  let title    = ""
  let category = ""

  try {
    const res = await fetch(`${backendUrl}/generate-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`backend ${res.status}`)
    const data = await res.json()
    title    = data.title    ?? ""
    category = data.category ?? ""
  } catch {
    return NextResponse.json({ ok: false, error: "naming_failed" })
  }

  if (!title) return NextResponse.json({ ok: false })

  // Update chat title
  await admin()
    .from("chats")
    .update({ title })
    .eq("id", chatId)
    .eq("user_id", user.id)

  // Backfill category into the latest analytics row for this chat
  if (category) {
    const { data: lastRow } = await admin()
      .from("query_analytics")
      .select("id")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (lastRow) {
      await admin()
        .from("query_analytics")
        .update({ category })
        .eq("id", lastRow.id)
    }
  }

  return NextResponse.json({ ok: true, title, category })
}
