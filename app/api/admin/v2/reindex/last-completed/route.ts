import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/admin/v2/reindex/last-completed`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({})
  }
}
