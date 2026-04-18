import { NextResponse } from "next/server"
import { cookies } from "next/headers"

const BACKEND = process.env.API_URL || "http://localhost:8000"

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const res = await fetch(`${BACKEND}/admin/text-index/status`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
