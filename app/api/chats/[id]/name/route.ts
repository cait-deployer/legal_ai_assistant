import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { GoogleAuth } from "google-auth-library"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const NAMING_PROMPT = `Ти — асистент з іменування юридичних чатів.
На основі першого запитання користувача та відповіді асистента дай:
1. Коротку назву чату (3-6 слів, українською)
2. Категорію зі списку: Цивільне право, Кримінальне право, Трудове право, Сімейне право, Корпоративне право, Нерухомість, Адміністративне право, Податкове право, Виконавче провадження, Інше

Відповідай ТІЛЬКИ у форматі JSON: {"title":"...","category":"..."}`

async function getVertexToken(saJson: string): Promise<string | null> {
  try {
    const sa = JSON.parse(saJson)
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    })
    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    return tokenResponse.token ?? null
  } catch {
    return null
  }
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

  // Load settings from app_settings
  const sb = admin()
  const { data: settings } = await sb
    .from("app_settings")
    .select("key, value_text, value_int, value_bool")

  const settingsMap: Record<string, string> = {}
  for (const row of (settings ?? [])) {
    const val = row.value_text ?? row.value_int ?? row.value_bool
    if (val != null && row.key) settingsMap[row.key] = String(val)
  }

  const saJson     = settingsMap["service_account_json"] ?? ""
  const modelName  = settingsMap["ai_model"]             ?? "gemini-2.0-flash-lite"
  const location   = settingsMap["vertex_location"]      ?? "us-central1"

  console.log("[name] settings loaded:", { hasSa: !!saJson, modelName, location })

  let title    = ""
  let category = ""

  if (!saJson) {
    console.error("[name] service_account_json not found in app_settings")
    return NextResponse.json({ ok: false, error: "no_service_account" })
  }

  try {
    const saObj   = JSON.parse(saJson)
    const project = saObj.project_id as string
    const token   = await getVertexToken(saJson)

    console.log("[name] vertex token:", token ? "ok" : "FAILED", "project:", project)

    if (!token) return NextResponse.json({ ok: false, error: "token_failed" })
    if (!project) return NextResponse.json({ ok: false, error: "no_project_id" })

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelName}:generateContent`
    console.log("[name] calling:", endpoint)

    const vertexRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: `${NAMING_PROMPT}\n\nЗапитання: ${question}\n\nВідповідь: ${answer.slice(0, 500)}` }],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!vertexRes.ok) {
      const errText = await vertexRes.text()
      console.error("[name] vertex error:", vertexRes.status, errText)
      return NextResponse.json({ ok: false, error: `vertex_${vertexRes.status}`, detail: errText })
    }

    const vd = await vertexRes.json()
    const raw = vd?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    console.log("[name] raw response:", raw)
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      title    = parsed.title    ?? ""
      category = parsed.category ?? ""
    }
  } catch (e) {
    console.error("[name] exception:", e)
    return NextResponse.json({ ok: false, error: String(e) })
  }

  if (!title) return NextResponse.json({ ok: false, error: "empty_title" })

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
