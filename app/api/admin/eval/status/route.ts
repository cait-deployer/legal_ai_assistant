import { NextResponse } from "next/server"
import { cookies } from "next/headers"

const BACKEND = process.env.BACKEND_URL || process.env.API_URL || "http://localhost:8000"

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

export async function GET() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const res = await fetch(`${BACKEND}/admin/eval/status`, { cache: "no-store" })
  return NextResponse.json(await res.json())
}
