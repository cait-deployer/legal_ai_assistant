import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/feedback/message — upsert inline message feedback
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json() as {
    message_id:          string
    chat_id:             string
    is_positive:         boolean
    tags?:               string[]
    feedback_text?:      string
    audio_transcription?: string
  }

  const { message_id, chat_id, is_positive, tags, feedback_text, audio_transcription } = body

  if (!message_id || !chat_id || is_positive === undefined) {
    return NextResponse.json({ error: "message_id, chat_id, is_positive required" }, { status: 400 })
  }

  // Upsert: one feedback per message per user, user can change their mind
  const { data, error } = await admin()
    .from("message_feedback")
    .upsert(
      {
        user_id:             user.id,
        chat_id,
        message_id,
        is_positive,
        tags:                tags ?? [],
        feedback_text:       feedback_text ?? null,
        audio_transcription: audio_transcription ?? null,
        updated_at:          new Date().toISOString(),
      },
      { onConflict: "message_id,user_id" }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
