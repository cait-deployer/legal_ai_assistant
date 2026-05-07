import { NextResponse } from "next/server"
import { cookies } from "next/headers"

const BACKEND = process.env.BACKEND_URL || process.env.API_URL || "http://localhost:8000"

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

export async function GET(req: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const lawId = searchParams.get("law_id")
  if (!lawId) return NextResponse.json({ error: "law_id required" }, { status: 400 })
  try {
    const res = await fetch(
      `${BACKEND}/admin/eval/debug_scroll?law_id=${encodeURIComponent(lawId)}`,
      { cache: "no-store" },
    )
    const text = await res.text()
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status })
    } catch {
      return NextResponse.json({ raw_error: text }, { status: res.status })
    }
  } catch (e) {
    return NextResponse.json({ fetch_error: String(e) }, { status: 500 })
  }
}
