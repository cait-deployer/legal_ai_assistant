import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

async function getCallerUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function anonymizePublicUserData(sb: ReturnType<typeof admin>, id: string) {
  await sb.from("onboarding_responses").delete().eq("user_id", id)

  const { error } = await sb
    .from("profiles")
    .update({
      email: `deleted-user-${id}@deleted.local`,
      full_name: "Deleted user",
      avatar_url: null,
      auth_provider: "deleted",
      last_ip: null,
      last_city: null,
      last_country: null,
      last_country_code: null,
      user_agent: null,
      browser_fingerprint: null,
      role: null,
      sub_role: [],
      segment: [],
      ai_personal_prompt: null,
      marketing_consent: false,
      email_confirmed: false,
      is_onboarded: false,
      is_beta_tester: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  return error
}

// GET /api/admin/users/[id] - ban and beta status
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
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

// PATCH /api/admin/users/[id] - edit profile or toggle ban
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  if (body.ban !== undefined) {
    type AdminUserUpdate = Parameters<ReturnType<typeof admin>["auth"]["admin"]["updateUserById"]>[1]
    const banUpdate: AdminUserUpdate & { ban_duration: string } = {
      ban_duration: body.ban ? "876000h" : "none",
    }
    const { error } = await admin().auth.admin.updateUserById(id, banUpdate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const update: Record<string, unknown> = {}
  if (body.subscription_tier !== undefined) update.subscription_tier = body.subscription_tier
  if (body.monthly_limit !== undefined) {
    update.monthly_limit = body.monthly_limit === "" || body.monthly_limit === null ? null : Number(body.monthly_limit)
  }
  if (body.bonus_requests !== undefined) {
    update.bonus_requests = body.bonus_requests === "" ? 0 : Number(body.bonus_requests)
  }
  if (body.is_beta_tester !== undefined) update.is_beta_tester = Boolean(body.is_beta_tester)

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin().from("profiles").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/users/[id] - delete auth user and anonymize public profile data
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const caller = await getCallerUser()
  if (caller?.id === id) {
    return NextResponse.json({ error: "Cannot delete the currently signed-in user" }, { status: 400 })
  }

  const sb = admin()
  const { error: authDeleteError } = await sb.auth.admin.deleteUser(id)
  if (authDeleteError && !/user not found/i.test(authDeleteError.message)) {
    return NextResponse.json({ error: authDeleteError.message }, { status: 500 })
  }

  const publicAnonymizeError = await anonymizePublicUserData(sb, id)
  if (publicAnonymizeError) return NextResponse.json({ error: publicAnonymizeError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
