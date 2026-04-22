import { NextRequest, NextResponse } from "next/server"
const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams.toString()
  try {
    const r = await fetch(`${BACKEND}/admin/v2/disk/files?${params}`, { cache: "no-store" })
    const data = await r.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
