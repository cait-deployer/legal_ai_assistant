import { type NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const law_id = req.nextUrl.searchParams.get("law_id") || ""
  try {
    const res = await fetch(
      `${BACKEND}/admin/supreme/laws/text?law_id=${encodeURIComponent(law_id)}`,
      { cache: "no-store" }
    )
    const data = await res.json()
    if (!res.ok) return NextResponse.json(data, { status: res.status })
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unavailable"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}