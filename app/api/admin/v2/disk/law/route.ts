import { NextRequest, NextResponse } from "next/server"
const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get("source") || ""
  const law_id = searchParams.get("law_id") || ""
  try {
    const r = await fetch(`${BACKEND}/admin/v2/disk/law?source=${source}&law_id=${encodeURIComponent(law_id)}`, { cache: "no-store" })
    const data = await r.json()
    return NextResponse.json(data, { status: r.status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
