import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createBrowserClient } from "@/lib/supabase/client"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Only email/password accounts can change password
  const provider = user.app_metadata?.provider ?? "email"
  if (provider !== "email") {
    return NextResponse.json({ error: "google_account" }, { status: 400 })
  }

  const { currentPassword, newPassword } = await request.json()
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 })
  }

  // Verify current password by attempting sign-in
  const verifyClient = createBrowserClient()
  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  })
  if (signInError) {
    return NextResponse.json({ error: "wrong_current_password" }, { status: 400 })
  }

  // Update password
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
