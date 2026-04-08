import { NextResponse } from "next/server"

// Credentials from .env (ADMIN_USERNAME / ADMIN_PASSWORD)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim() || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "rada2025"

export async function POST(request: Request) {
  const body = await request.json()
  const { username, password } = body

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const response = NextResponse.json({ success: true })
    response.cookies.set("admin_session", "authenticated", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
      sameSite: "lax",
    })
    return response
  }

  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
}
