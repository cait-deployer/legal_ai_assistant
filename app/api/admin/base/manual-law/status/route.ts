import { NextResponse } from "next/server"
import { readBackendJson } from "../backend-response"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/admin/base/manual-law/status`, {
      cache: "no-store",
    })
    const data = await readBackendJson(res)
    if (!res.ok) return NextResponse.json(data, { status: res.status })
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unavailable"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
