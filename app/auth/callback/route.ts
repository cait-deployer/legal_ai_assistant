import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

async function getGeo(ip: string): Promise<Record<string, string>> {
  if (!ip || ["127.0.0.1", "::1", "localhost", ""].includes(ip)) return {}
  const priv = ["10.", "172.16.", "172.17.", "192.168.", "::ffff:127."]
  if (priv.some(p => ip.startsWith(p))) return {}
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,city,country,countryCode&lang=uk`,
      { signal: AbortSignal.timeout(3000) },
    )
    const d = await res.json()
    if (d.status === "success") return { city: d.city ?? "", country: d.country ?? "", country_code: d.countryCode ?? "" }
  } catch { /* geo not critical */ }
  return {}
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Behind nginx proxy: reconstruct public origin from forwarded headers
  // x-forwarded-host can contain multiple comma-separated values — take first only
  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || ""
  const host = rawHost.split(",")[0].trim()
  const proto = (request.headers.get("x-forwarded-proto") || "https").split(",")[0].trim()
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin

  const code  = searchParams.get("code")
  const next  = searchParams.get("next") ?? "/"
  const type  = searchParams.get("type")
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  if (error) {
    const url = new URL("/auth/login", origin)
    url.searchParams.set("error", errorDescription ?? error)
    return NextResponse.redirect(url)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
  }

  // ── After successful auth: record IP/geo/UA + set auth_provider ──────────
  const user = sessionData?.user
  if (user) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (serviceKey) {
      const forwarded = request.headers.get("x-forwarded-for")
      const ip = forwarded ? forwarded.split(",")[0].trim() : (request.headers.get("x-real-ip") ?? "")
      const ua = request.headers.get("user-agent") ?? ""
      const geo = await getGeo(ip)
      const provider = user.app_metadata?.provider ?? "email"

      const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      // Use upsert so it works even if the profile row doesn't exist yet
      // (new Google users: profile is created during onboarding, but we pre-fill tracking data)
      await admin.from("profiles").upsert({
        id:                user.id,
        email:             user.email ?? "",
        last_ip:           ip || null,
        user_agent:        ua || null,
        last_city:         geo.city || null,
        last_country:      geo.country || null,
        last_country_code: geo.country_code || null,
        auth_provider:     provider,
        last_active_at:    new Date().toISOString(),
        updated_at:        new Date().toISOString(),
        // Google: sync display info
        full_name:  user.user_metadata?.full_name ?? null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        ...(provider === "google" ? { email_confirmed: true } : {}),
      }, {
        onConflict: "id",
        ignoreDuplicates: false,
      })
    }
  }

  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  const safeNext = next.startsWith("/") ? next : "/"
  return NextResponse.redirect(`${origin}${safeNext}`)
}
