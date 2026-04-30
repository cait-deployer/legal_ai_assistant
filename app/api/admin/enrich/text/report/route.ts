import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const params = url.searchParams.toString()
    const res = await fetch(`${BACKEND}/admin/enrich/text/report?${params}`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
