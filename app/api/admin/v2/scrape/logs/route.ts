import { NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const source = new URL(req.url).searchParams.get("source") ?? ""
  try {
    const res = await fetch(`${BACKEND}/admin/v2/scrape/logs?source=${source}`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
