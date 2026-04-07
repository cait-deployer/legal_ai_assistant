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

const NAMING_PROMPT = `Ти — юридичний асистент. Проаналізуй запит користувача та відповідь AI.

Поверни СТРОГО JSON без жодного іншого тексту:
{"title":"назва до 5 слів без лапок","category":"категорія права"}

Категорії: Трудове, Кримінальне, Цивільне, ФОП/Бізнес, Сімейне, Нерухомість, Мобілізація, Захист прав, Інше`

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

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY
  const model  = process.env.AI_MODEL ?? "gemini-2.0-flash-lite"

  let title    = ""
  let category = ""

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${NAMING_PROMPT}\n\nЗапит: ${question.slice(0, 500)}\nВідповідь: ${answer.slice(0, 500)}`,
            }],
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 60 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    )
    const data = await res.json()
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    // Strip markdown code fences if model wraps in ```json
    const json = raw.replace(/```json?|```/gi, "").trim()
    const parsed = JSON.parse(json)
    title    = (parsed.title    ?? "").slice(0, 80)
    category = (parsed.category ?? "").slice(0, 50)
  } catch {
    // Naming failed — not critical, keep default title
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
