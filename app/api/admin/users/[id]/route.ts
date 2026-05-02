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

async function getCallerUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET /api/admin/users/[id] — ban status
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await getCallerUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = admin()
  const { data, error } = await sb.auth.admin.getUserById(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bannedUntil = (data.user as { banned_until?: string | null }).banned_until
  const isBanned = bannedUntil ? new Date(bannedUntil) > new Date() : false
  const { data: profile } = await sb
    .from("profiles")
    .select("is_beta_tester")
    .eq("id", id)
    .maybeSingle()

  return NextResponse.json({ is_banned: isBanned, is_beta_tester: profile?.is_beta_tester ?? false })
}

// PATCH /api/admin/users/[id] — edit profile OR toggle ban
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await getCallerUser()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()

  // Toggle ban via Supabase Auth
  if (body.ban !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin().auth.admin.updateUserById(id, {
      ban_duration: body.ban ? "876000h" : "none",
    } as any)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Update profile fields
  const update: Record<string, unknown> = {}
  if (body.subscription_tier !== undefined) update.subscription_tier = body.subscription_tier
  if (body.monthly_limit !== undefined)
    update.monthly_limit = body.monthly_limit === "" || body.monthly_limit === null ? null : Number(body.monthly_limit)
  if (body.bonus_requests !== undefined)
    update.bonus_requests = body.bonus_requests === "" ? 0 : Number(body.bonus_requests)
  if (body.is_beta_tester !== undefined)
    update.is_beta_tester = Boolean(body.is_beta_tester)

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin().from("profiles").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/users/[id] — delete user (auth cascade → profiles)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerUser()
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (caller.id === id) return NextResponse.json({ error: "Не можна видалити себе" }, { status: 400 })

  const { error } = await admin().auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
