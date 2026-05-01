import { NextResponse } from "next/server"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/admin/pipeline/status`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ running: false, live_logs: [], last_run: null, step_names: [] })
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const action = (body as { action?: string }).action

  if (action === "stop") {
    try {
      const res = await fetch(`${BACKEND}/admin/pipeline/stop`, { method: "POST" })
      const data = await res.json()
      return NextResponse.json(data, { status: res.status })
    } catch {
      return NextResponse.json({ error: "Backend недоступний" }, { status: 502 })
    }
  }

  try {
    const res = await fetch(`${BACKEND}/admin/pipeline/trigger`, { method: "POST" })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend недоступний" }, { status: 502 })
  }
}
