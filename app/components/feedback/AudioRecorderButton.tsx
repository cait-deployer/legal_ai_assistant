"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, Loader2 } from "lucide-react"
import { useAudioRecorder } from "@/app/hooks/useAudioRecorder"

interface Props {
  onTranscription: (text: string) => void
}

export function AudioRecorderButton({ onTranscription }: Props) {
  const { state, transcription, start, stop } = useAudioRecorder()
  const [supported, setSupported] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const onTranscriptionRef = useRef(onTranscription)
  useEffect(() => { onTranscriptionRef.current = onTranscription }, [onTranscription])

  // Check WebM support only on client after hydration
  useEffect(() => {
    setSupported(
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm")
    )
  }, [])

  // Recording timer
  useEffect(() => {
    if (state !== "recording") { setSeconds(0); return }
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  // Surface transcription to parent when ready — ref avoids re-firing on every render
  useEffect(() => {
    if (state === "done" && transcription) {
      onTranscriptionRef.current(transcription)
    }
  }, [state, transcription])

  if (!supported) return null

  const handleClick = async () => {
    if (state === "recording") stop()
    else if (state === "idle" || state === "done" || state === "error") await start()
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "processing"}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
        state === "recording"
          ? "bg-red-500/20 text-red-400 border border-red-500/40"
          : state === "processing"
          ? "bg-[#C9A84C]/10 text-[#C9A84C]/60 border border-[#C9A84C]/20 cursor-not-allowed"
          : "bg-white/5 text-[#E0E6ED]/60 border border-white/10 hover:border-[#C9A84C]/30 hover:text-[#C9A84C]",
      ].join(" ")}
    >
      {state === "processing" ? (
        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Розпізнається...</>
      ) : state === "recording" ? (
        <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> {fmt(seconds)} Зупинити</>
      ) : (
        <><Mic className="w-3.5 h-3.5" /> Голос</>
      )}
    </button>
  )
}
