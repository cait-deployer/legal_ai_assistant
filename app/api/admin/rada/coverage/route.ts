import { type NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "true"
  try {
    const res = await fetch(
      `${BACKEND}/admin/rada/coverage${refresh ? "?refresh=true" : ""}`,
      { cache: "no-store" },
    )
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
