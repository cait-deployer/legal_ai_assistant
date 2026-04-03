import { NextResponse } from "next/server"

const ADMIN_USERNAME = "admin"
const ADMIN_PASSWORD = "rada2025"

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
