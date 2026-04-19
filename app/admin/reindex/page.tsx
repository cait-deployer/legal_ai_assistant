"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Building2, Play, Square, Loader2, RefreshCw,
  Info, RotateCcw, Scale,
} from "lucide-react"

type LogEntry = {
  ts: string
  message: string
  level: "info" | "success" | "error" | "warning"
}

type ResumeProgress = {
  next_index: number
  ok: number
  errors: number
}

type PanelState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ResumeProgress | null
}

function logColor(level: string) {
  switch (level) {
    case "error":   return "text-red-400"
    case "success": return "text-emerald-400"
    case "warning": return "text-amber-400"
    default:        return "text-[#E0E6ED]/70"
  }
}

function ReindexPanel({
  title,
  subtitle,
  icon: Icon,
  color,
  infoText,
  logsUrl,
  triggerUrl,
  stopUrl,
  resumeUrl,
}: {
  title: string
  subtitle: string
  icon: React.ElementType
  color: string
  infoText: string
  logsUrl: string
  triggerUrl: string
  stopUrl: string
  resumeUrl: string
}) {
  const [state, setState] = useState<PanelState>({
    running: false,
    pause_requested: false,
    live_logs: [],
    can_resume: false,
    resume_progress: null,
  })
  const [error, setError] = useState("")
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = async () => {
    try {
      const r = await fetch(logsUrl)
      const d = await r.json()
      setState({
        running:         d.running ?? false,
        pause_requested: d.pause_requested ?? false,
        live_logs:       d.live_logs ?? [],
        can_resume:      d.can_resume ?? false,
        resume_progress: d.resume_progress ?? null,
      })
      setLastUpdated(new Date())
    } catch {}
  }

  useEffect(() => { fetchLogs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.running) {
      pollRef.current = setInterval(fetchLogs, 5000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state.running]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.live_logs])

  const handleStart = async () => {
    setError("")
    setState(s => ({ ...s, running: true }))
    try {
      const res = await fetch(triggerUrl, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка запуску")
        setState(s => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setState(s => ({ ...s, running: false }))
      setError("Не вдалося підключитися до бекенду")
    }
  }

  const handleStop = async () => {
    setError("")
    try {
      await fetch(stopUrl, { method: "POST" })
      setState(s => ({ ...s, pause_requested: true }))
      await fetchLogs()
    } catch {}
  }

  const handleResume = async () => {
    setError("")
    setState(s => ({ ...s, running: true }))
    try {
      const res = await fetch(resumeUrl, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка відновлення")
        setState(s => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setState(s => ({ ...s, running: false }))
      setError("Не вдалося підключитися до бекенду")
    }
  }

  const borderColor = state.running
    ? state.pause_requested ? "border-blue-500/30" : `border-${color}-500/30`
    : "border-[#C9A84C]/10"

  return (
    <div className={`bg-[#0d1120]/60 border rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 ${borderColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl bg-${color}-500/10 border border-${color}-500/20 flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 text-${color}-400`} />
          </div>
          <div>
            <p className="font-semibold text-sm text-[#E0E6ED]">{title}</p>
            <p className="text-xs text-[#E0E6ED]/50 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.running && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-${color}-500/10 border border-${color}-500/20 text-${color}-400`}>
              <Loader2 className="w-3 h-3 animate-spin" />
              {state.pause_requested ? "Зупиняється..." : "Виконується"}
            </span>
          )}
          {lastUpdated && (
            <span className="text-[10px] text-[#C9A84C]/40 font-mono">
              {lastUpdated.toLocaleTimeString("uk-UA")}
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={fetchLogs}
            className="h-8 w-8 p-0 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Info */}
      <p className="text-xs text-[#E0E6ED]/50">{infoText}</p>

      {/* Resume banner */}
      {state.can_resume && state.resume_progress && !state.running && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-blue-500/30 bg-blue-500/5">
          <div>
            <p className="text-xs font-semibold text-blue-400">Є збережений прогрес</p>
            <p className="text-[10px] text-blue-400/60 mt-0.5">
              Документ {state.resume_progress.next_index} — OK: {state.resume_progress.ok} / Помилки: {state.resume_progress.errors}
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleResume}
            className="gap-1 h-8 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 font-black uppercase tracking-wider text-[10px] shrink-0"
          >
            <RotateCcw className="w-3 h-3" /> Відновити
          </Button>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Controls */}
      <div className="flex gap-2">
        {state.running && (
          <Button
            size="sm" variant="ghost"
            onClick={handleStop}
            disabled={state.pause_requested}
            className="gap-1.5 h-9 rounded-xl border border-red-500/30 hover:border-red-500/50 hover:bg-red-500/10 text-red-400 font-black uppercase tracking-wider text-[10px]"
          >
            <Square className="w-3.5 h-3.5" />
            {state.pause_requested ? "Зупиняється..." : "Зупинити"}
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleStart}
          disabled={state.running}
          className="gap-1.5 h-9 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#C9A84C]/10 disabled:opacity-40"
        >
          {state.running
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Виконується</>
            : <><Play className="w-3.5 h-3.5" /> Запустити</>}
        </Button>
      </div>

      {/* Live logs */}
      {state.live_logs.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {state.running && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
            <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.15em]">
              Лог переіндексу {state.running && "— оновлення кожні 5 сек"}
            </p>
          </div>
          <div className="bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 font-mono text-[11px] h-56 overflow-y-auto p-3 space-y-0.5">
            {state.live_logs.map((log, i) => (
              <div key={i} className={`flex gap-2 ${logColor(log.level)}`}>
                <span className="shrink-0 opacity-50 tabular-nums">
                  {new Date(log.ts).toLocaleTimeString("uk-UA")}
                </span>
                <span className="break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReindexPage() {
  return (
    <div className="flex flex-col h-full">

      {/* Page header */}
      <div className="flex items-center gap-3 pb-4 border-b border-[#C9A84C]/10 shrink-0">
        <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
          <RefreshCw className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
        </div>
        <div>
          <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Переіндексація бази</h1>
          <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">
            Повний переіндекс колекцій з оновленим chunk_size та title-prefix embedding
          </p>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto py-5 space-y-4">

        {/* Warning banner */}
        <div className="flex gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-sm text-amber-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">Важливо перед запуском</p>
            <p className="text-amber-400/70 text-xs">
              Переіндекс видаляє старі чанки та завантажує нові з покращеними налаштуваннями
              (chunk_size 1500→3000/4000, title-prefix embedding, 8 воркерів).
              Тривалість: <strong>КМУ ~10–12 год, Рада ~20–30 год</strong>.
              Під час переіндексу бекенд продовжує відповідати на запити.
              Зупинка зберігає прогрес — можна відновити.
            </p>
          </div>
        </div>

        {/* Two panels side by side on large screens */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ReindexPanel
            title="Переіндекс КМУ"
            subtitle="laws_kmu — ~88 000 НПА КМУ"
            icon={Building2}
            color="amber"
            infoText="Постанови та розпорядження КМУ. Chunk: 4000 символів, overlap: 400. Title-prefix у кожному чанку."
            logsUrl="/api/admin/reindex/kmu/logs"
            triggerUrl="/api/admin/reindex/kmu/trigger"
            stopUrl="/api/admin/reindex/kmu/stop"
            resumeUrl="/api/admin/reindex/kmu/resume"
          />
          <ReindexPanel
            title="Переіндекс Ради"
            subtitle="12 колекцій rada_* — ~120 000 законів"
            icon={Scale}
            color="emerald"
            infoText="Закони Верховної Ради по всіх 12 категоріях. Chunk: 3000 символів, overlap: 300. Title-prefix у кожному чанку."
            logsUrl="/api/admin/reindex/rada/logs"
            triggerUrl="/api/admin/reindex/rada/trigger"
            stopUrl="/api/admin/reindex/rada/stop"
            resumeUrl="/api/admin/reindex/rada/resume"
          />
        </div>

      </div>
    </div>
  )
}
