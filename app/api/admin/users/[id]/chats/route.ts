import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await cookies()
  if (c.get("admin_session")?.value !== "authenticated")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { data, error } = await admin()
    .from("chats")
    .select("id, title, created_at, updated_at, context_summary")
    .eq("user_id", id)
    .order("updated_at", { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
