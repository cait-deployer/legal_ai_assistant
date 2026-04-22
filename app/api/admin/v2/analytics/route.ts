import { NextResponse, NextRequest } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const qs = searchParams.toString()
    const res = await fetch(`${BACKEND}/admin/v2/analytics${qs ? "?" + qs : ""}`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
