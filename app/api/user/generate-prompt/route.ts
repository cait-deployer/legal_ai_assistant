import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

const BACKEND = process.env.API_URL || "http://localhost:8000"

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Дані профілю для генерації — або з тіла запиту (онбординг), або з бази
  let role: string | null = null
  let sub_role: string[] = []
  let segment: string[] = []

  const body = await request.json().catch(() => null)
  if (body?.role !== undefined) {
    role = body.role ?? null
    sub_role = body.sub_role ?? []
    segment = body.segment ?? []
  } else {
    const { data: profile } = await adminClient()
      .from("profiles")
      .select("role, sub_role, segment")
      .eq("id", user.id)
      .single()
    role = profile?.role ?? null
    sub_role = profile?.sub_role ?? []
    segment = profile?.segment ?? []
  }

  // Генерація через бекенд
  const res = await fetch(`${BACKEND}/generate-user-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, sub_role, segment }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) return NextResponse.json({ error: "Generation failed" }, { status: 500 })

  const { prompt } = await res.json()
  if (!prompt) return NextResponse.json({ error: "Empty prompt" }, { status: 500 })

  // Зберігаємо в profiles
  const { error: updateError } = await adminClient()
    .from("profiles")
    .update({ ai_personal_prompt: prompt })
    .eq("id", user.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ prompt })
}
