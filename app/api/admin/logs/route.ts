import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = searchParams.get("limit") ?? "20"
    const res = await fetch(`${BACKEND}/admin/logs?limit=${limit}`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
