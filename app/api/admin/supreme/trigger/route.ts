import { NextResponse } from "next/server"

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export async function POST() {
  try {
    const res = await fetch(`${BACKEND}/admin/supreme/trigger`, { method: "POST" })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}