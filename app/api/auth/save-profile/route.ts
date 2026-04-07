import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

export async function POST(request: Request) {
  // ── 1. Verify session server-side ─────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { segments, role, subRole } = body as {
    segments: string[]
    role: string
    subRole: string | null
  }

  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: "segments required" }, { status: 400 })
  }
  if (!role) {
    return NextResponse.json({ error: "role required" }, { status: 400 })
  }

  // ── 2. Upsert with service role key — bypasses RLS ────────────────────────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey || serviceKey === "your_service_role_key_here") {
    console.error("SUPABASE_SERVICE_ROLE_KEY is not configured")
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error: upsertError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name ?? null,
      segment:      segments,
      role:         role,
      sub_role:     subRole ? [subRole] : [],
      is_onboarded: true,
      // Google OAuth: email_confirmed_at is set at sign-up; email/password: set after link click
      email_confirmed: !!user.email_confirmed_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  )

  if (upsertError) {
    console.error("Upsert error:", upsertError.message, upsertError.details)
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  // ── 3. Set onboarding cookie so middleware skips DB check next time ───────
  const response = NextResponse.json({ ok: true })
  response.cookies.set("_ob", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: "lax",
  })
  return response
}
