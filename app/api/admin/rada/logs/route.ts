import { NextResponse } from "next/server"

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/admin/rada/logs`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ running: false, live_logs: [], history: [] })
  }
}
