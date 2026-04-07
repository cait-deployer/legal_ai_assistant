import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Admin routes — keep existing cookie-based auth ──────────────────────
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const session = request.cookies.get("admin_session")
    if (!session || session.value !== "authenticated") {
      const loginUrl = new URL("/admin/login", request.url)
      loginUrl.searchParams.set("from", pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // ── Supabase session refresh
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: getUser() refreshes the session — must be called every time
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthPage =
    pathname.startsWith("/auth") && !pathname.startsWith("/auth/callback")
  const isOnboardingPage = pathname === "/onboarding"
  const isProtected = pathname === "/" || pathname.startsWith("/chat") || pathname.startsWith("/settings")
  const needsAuth = isProtected || isOnboardingPage

  // ── Not logged in → redirect to login ───────────────────────────────────
  if (needsAuth && !user) {
    const url = new URL("/auth/login", request.url)
    url.searchParams.set("from", pathname)
    return NextResponse.redirect(url)
  }

  if (user && needsAuth) {
    // One DB query for both checks — email_confirmed + is_onboarded
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email_confirmed, is_onboarded")
      .eq("id", user.id)
      .single()

    // If column doesn't exist yet (schema not patched) fall back to auth.users value
    // so we never get stuck in a redirect loop due to a missing DB column
    if (profileError) {
      // PGRST116 = no rows found (not onboarded yet) — other errors = schema/network issue
      if (profileError.code !== "PGRST116") {
        // Schema likely missing email_confirmed — use auth.users as source of truth
        const provider = user.app_metadata?.provider ?? "email"
        const emailConfirmed = !!user.email_confirmed_at
        if (provider === "email" && !emailConfirmed) {
          const url = new URL("/auth/verify-email", request.url)
          if (user.email) url.searchParams.set("email", user.email)
          return NextResponse.redirect(url)
        }
        // Can't check is_onboarded — let through, onboarding page handles it
        if (isAuthPage) return NextResponse.redirect(new URL("/", request.url))
        return supabaseResponse
      }
      // No profile row at all → redirect to onboarding
      if (isProtected) {
        const redirect = NextResponse.redirect(new URL("/onboarding", request.url))
        redirect.cookies.delete("_ob")
        return redirect
      }
    }

    const provider = user.app_metadata?.provider ?? "email"
    // Fallback to auth.users if profile row doesn't exist yet
    const emailConfirmed = profile?.email_confirmed ?? !!user.email_confirmed_at

    // ── Email/password: email must be confirmed before anything else ───────
    if (provider === "email" && !emailConfirmed) {
      const url = new URL("/auth/verify-email", request.url)
      if (user.email) url.searchParams.set("email", user.email)
      return NextResponse.redirect(url)
    }

    // ── Protected routes: must be onboarded ────────────────────────────────
    if (isProtected && !profile?.is_onboarded) {
      const redirect = NextResponse.redirect(new URL("/onboarding", request.url))
      redirect.cookies.delete("_ob")
      return redirect
    }

    if (isProtected && profile?.is_onboarded) {
      supabaseResponse.cookies.set("_ob", "1", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: "lax",
      })
    }
  }

  // ── Already logged in (confirmed) → don't show auth pages ───────────────
  if (user && isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
