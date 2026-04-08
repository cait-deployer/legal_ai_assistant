import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── /api/admin/* — без перевірок (login API має бути доступний) ────────────
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.next()
  }

  // ── /admin/* крім /admin/login → потрібен admin_session cookie ─────────────
  // Адмін-логін НЕ залежить від Supabase — окрема cookie-авторизація
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const session = request.cookies.get("admin_session")
    if (!session || session.value !== "authenticated") {
      const loginUrl = new URL("/admin/login", request.url)
      loginUrl.searchParams.set("from", pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // ── /admin/login — доступна без будь-якої авторизації ─────────────────────
  if (pathname === "/admin/login") {
    return NextResponse.next()
  }

  // ── Решта маршрутів — Supabase session management ──────────────────────────
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
  const isProtected =
    pathname === "/" ||
    pathname.startsWith("/chat") ||
    pathname.startsWith("/settings") ||
    pathname === "/onboarding"

  // ── Не залогінений → редірект на login ────────────────────────────────────
  if (isProtected && !user) {
    const url = new URL("/auth/login", request.url)
    url.searchParams.set("from", pathname)
    return NextResponse.redirect(url)
  }

  if (user && isProtected) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email_confirmed, is_onboarded")
      .eq("id", user.id)
      .single()

    if (profileError) {
      if (profileError.code !== "PGRST116") {
        const provider = user.app_metadata?.provider ?? "email"
        const emailConfirmed = !!user.email_confirmed_at
        if (provider === "email" && !emailConfirmed) {
          const url = new URL("/auth/verify-email", request.url)
          if (user.email) url.searchParams.set("email", user.email)
          return NextResponse.redirect(url)
        }
        if (isAuthPage) return NextResponse.redirect(new URL("/", request.url))
        return supabaseResponse
      }
      if (pathname !== "/onboarding") {
        const redirect = NextResponse.redirect(new URL("/onboarding", request.url))
        redirect.cookies.delete("_ob")
        return redirect
      }
    }

    const provider = user.app_metadata?.provider ?? "email"
    const emailConfirmed = profile?.email_confirmed ?? !!user.email_confirmed_at

    if (provider === "email" && !emailConfirmed) {
      const url = new URL("/auth/verify-email", request.url)
      if (user.email) url.searchParams.set("email", user.email)
      return NextResponse.redirect(url)
    }

    if (
      pathname !== "/onboarding" &&
      !profile?.is_onboarded &&
      (pathname === "/" || pathname.startsWith("/chat") || pathname.startsWith("/settings"))
    ) {
      const redirect = NextResponse.redirect(new URL("/onboarding", request.url))
      redirect.cookies.delete("_ob")
      return redirect
    }

    if (profile?.is_onboarded) {
      supabaseResponse.cookies.set("_ob", "1", {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: "lax",
      })
    }
  }

  // ── Вже залогінений → не показувати auth-сторінки ─────────────────────────
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
