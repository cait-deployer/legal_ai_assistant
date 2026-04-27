import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const params = new URLSearchParams()
    for (const key of ["source", "dead", "doc_type", "theme", "q", "limit", "offset"]) {
      const v = searchParams.get(key)
      if (v !== null) params.set(key, v)
    }
    const res = await fetch(`${BACKEND}/admin/meta/list?${params}`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
