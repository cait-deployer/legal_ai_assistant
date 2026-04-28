import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const SUPPORTED_TYPES = ["audio/webm", "audio/mp3", "audio/wav", "audio/flac", "audio/ogg"]
const MAX_BYTES = 5 * 1024 * 1024  // 5 MB

// POST /api/feedback/audio — receive audio blob, return Whisper transcription
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get("audio") as File | null

  if (!file) return NextResponse.json({ error: "audio field required" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Audio too large (max 5MB)" }, { status: 413 })

  // Chrome records audio/webm;codecs=opus — match by prefix
  const mime = file.type || "audio/webm"
  const supported = SUPPORTED_TYPES.some(t => mime === t || mime.startsWith(t + ";") || mime.startsWith(t))
  if (!supported) {
    return NextResponse.json(
      { error: "unsupported_format", message: "Ваш браузер не підтримує запис у форматі WebM. Будь ласка, введіть текст вручну." },
      { status: 415 }
    )
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 })
  }

  try {
    const transcription = await groq.audio.transcriptions.create({
      file,
      model:    "whisper-large-v3",
      language: "uk",
      response_format: "json",
    })

    return NextResponse.json({ transcription: transcription.text ?? "" })
  } catch (err) {
    console.error("[feedback/audio] Groq error:", err)
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 })
  }
}
