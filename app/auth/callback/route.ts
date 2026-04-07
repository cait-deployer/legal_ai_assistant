import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  const code  = searchParams.get("code")
  const next  = searchParams.get("next") ?? "/"
  const type  = searchParams.get("type") // "recovery" | "email" | "signup" | null
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // ── OAuth / Supabase error
  if (error) {
    const url = new URL("/auth/login", origin)
    url.searchParams.set("error", errorDescription ?? error)
    return NextResponse.redirect(url)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
  }

  // Password recovery → reset-password page
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/auth/reset-password`)
  }

  // ── Email confirmation (signup) → go to onboarding (middleware handles it) ─
  // Middleware will redirect to /onboarding if is_onboarded === false
  // Safe redirect: only allow relative paths from our origin
  const safeNext = next.startsWith("/") ? next : "/"
  return NextResponse.redirect(`${origin}${safeNext}`)
}
