import { NextResponse } from "next/server"
const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET() {
  try {
    const r = await fetch(`${BACKEND}/admin/v2/disk/by-collection`, { cache: "no-store" })
    const data = await r.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
