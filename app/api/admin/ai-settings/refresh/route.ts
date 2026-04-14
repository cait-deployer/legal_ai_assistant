import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function POST() {
  try {
    const res = await fetch(`${BACKEND}/admin/settings/refresh`, { method: "POST" })
    if (!res.ok) return NextResponse.json({ error: "Backend error" }, { status: res.status })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
