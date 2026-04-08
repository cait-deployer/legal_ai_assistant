import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/admin/stats`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      doc_count: 0,
      last_sync: null,
      schedule_enabled: true,
      scraping_running: false,
    })
  }
}
