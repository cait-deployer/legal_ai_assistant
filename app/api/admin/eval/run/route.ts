import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"

const BACKEND = process.env.BACKEND_URL || process.env.API_URL || "http://localhost:8000"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

export async function POST() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = admin()
  const { data: cases, error } = await sb
    .from("rag_eval_cases")
    .select("id, question, expected_sources, bad_sources, is_gold, status")
    .or("is_gold.eq.true,status.eq.approved")
    .order("is_gold", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!cases?.length) return NextResponse.json({ error: "Немає approved/gold кейсів" }, { status: 400 })

  const res = await fetch(`${BACKEND}/admin/eval/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cases }),
  })
  const data = await res.json()
  if (!res.ok) return NextResponse.json(data, { status: res.status })
  return NextResponse.json({ ...data, cases_loaded: cases.length })
}

export async function DELETE() {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const res = await fetch(`${BACKEND}/admin/eval/stop`, { method: "POST" })
  return NextResponse.json(await res.json())
}
