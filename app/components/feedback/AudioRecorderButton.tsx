"use client"

import { Mic, Square, Loader2 } from "lucide-react"
import { useAudioRecorder } from "@/app/hooks/useAudioRecorder"

interface Props {
  onTranscription: (text: string) => void
}

function isWebmSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("audio/webm")
  )
}

export function AudioRecorderButton({ onTranscription }: Props) {
  const { state, transcription, start, stop } = useAudioRecorder()

  // Safari doesn't support webm — hide the button entirely
  if (!isWebmSupported()) return null

  const handleClick = async () => {
    if (state === "recording") {
      stop()
    } else if (state === "idle" || state === "done" || state === "error") {
      await start()
    }
  }

  // Surface transcription to parent when ready
  if (state === "done" && transcription) {
    onTranscription(transcription)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "processing"}
      title={
        state === "recording"  ? "Зупинити запис" :
        state === "processing" ? "Транскрибується..." :
        "Записати голосовий відгук"
      }
      className={[
        "flex items-center justify-center w-8 h-8 rounded-full transition-colors",
        state === "recording"
          ? "bg-red-500 text-white animate-pulse"
          : state === "processing"
          ? "bg-[#C9A84C]/30 text-[#C9A84C] cursor-not-allowed"
          : "bg-white/10 text-[#E0E6ED] hover:bg-[#C9A84C]/20 hover:text-[#C9A84C]",
      ].join(" ")}
    >
      {state === "processing" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : state === "recording" ? (
        <Square className="w-3.5 h-3.5" />
      ) : (
        <Mic className="w-4 h-4" />
      )}
    </button>
  )
}
