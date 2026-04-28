"use client"

import { useState, useRef, useCallback } from "react"

export type RecorderState = "idle" | "recording" | "processing" | "done" | "error"

export interface UseAudioRecorderReturn {
  state:       RecorderState
  transcription: string
  start:       () => Promise<void>
  stop:        () => void
  reset:       () => void
}

// Safari doesn't support audio/webm — fall back to audio/mp4
function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t
  }
  return ""
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<RecorderState>("idle")
  const [transcription, setTranscription] = useState("")
  const mediaRef  = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const start = useCallback(async () => {
    if (state === "recording") return
    setTranscription("")
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState("error")
      return
    }

    const mimeType  = getSupportedMimeType()
    const recorder  = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setState("processing")

      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" })
      try {
        const form = new FormData()
        form.append("audio", blob, "recording.webm")
        const res  = await fetch("/api/feedback/audio", { method: "POST", body: form })
        const json = await res.json()
        setTranscription(json.transcription ?? "")
        setState("done")
      } catch {
        setState("error")
      }
    }

    recorder.start()
    setState("recording")
  }, [state])

  const stop = useCallback(() => {
    if (mediaRef.current?.state === "recording") {
      mediaRef.current.stop()
    }
  }, [])

  const reset = useCallback(() => {
    stop()
    setState("idle")
    setTranscription("")
  }, [stop])

  return { state, transcription, start, stop, reset }
}
