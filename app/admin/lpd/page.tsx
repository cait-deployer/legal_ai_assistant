"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Scale, Play, Pause, Loader2, RefreshCw,
  CheckCircle, XCircle, Info, FileText, RotateCcw,
} from "lucide-react"

type LogEntry = {
  ts: string
  message: string
  level: "info" | "success" | "error" | "warning"
}

type HistoryEntry = {
  id?: number
  status: string
  started_at: string
  finished_at?: string
  laws_processed?: number
  error_message?: string
}

type ResumeProgress = {
  next_index: number
  saved_at: string
  total: number
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
        <CheckCircle className="w-3 h-3" /> Успішно
      </span>
    )
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
        <XCircle className="w-3 h-3" /> Помилка
      </span>
    )
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" /> Виконується
      </span>
    )
  if (status === "paused")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
        <Pause className="w-3 h-3" /> Призупинено
      </span>
    )
  return (
    <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[#C9A84C]/70 shrink-0">
      {status}
    </span>
  )
}

function logColor(level: string) {
  switch (level) {
    case "error":   return "text-red-400"
    case "success": return "text-emerald-400"
    case "warning": return "text-amber-400"
    default:        return "text-[#E0E6ED]/70"
  }
}

export default function LpdPage() {
  const [scraping, setScraping]           = useState(false)
  const [pausing, setPausing]             = useState(false)
  const [liveLogs, setLiveLogs]           = useState<LogEntry[]>([])
  const [history, setHistory]             = useState<HistoryEntry[]>([])
  const [lastUpdated, setLastUpdated]     = useState<Date | null>(null)
  const [triggerError, setTriggerError]   = useState("")
  const [canResume, setCanResume]         = useState(false)
  const [resumeProgress, setResumeProgress] = useState<ResumeProgress | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = async () => {
    try {
      const r = await fetch("/api/admin/lpd/logs")
      const d = await r.json()
      setScraping(d.running ?? false)
      setPausing(d.pause_requested ?? false)
      setLiveLogs(d.live_logs ?? [])
      setHistory(d.history ?? [])
      setCanResume(d.can_resume ?? false)
      setResumeProgress(d.resume_progress ?? null)
      setLastUpdated(new Date())
    } catch {}
  }

  useEffect(() => { fetchLogs() }, [])

  useEffect(() => {
    if (scraping) {
      pollRef.current = setInterval(fetchLogs, 5000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [scraping])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [liveLogs])

  const handleStart = async () => {
    setTriggerError("")
    setScraping(true)
    try {
      const res = await fetch("/api/admin/lpd/trigger", { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setTriggerError(d.detail ?? d.error ?? "Помилка запуску")
        setScraping(false)
        return
      }
      await fetchLogs()
    } catch {
      setScraping(false)
      setTriggerError("Не вдалося підключитися до бекенду")
    }
  }

  const handleResume = async () => {
    setTriggerError("")
    setScraping(true)
    try {
      const res = await fetch("/api/admin/lpd/resume", { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setTriggerError(d.detail ?? d.error ?? "Помилка відновлення")
        setScraping(false)
        return
      }
      await fetchLogs()
    } catch {
      setScraping(false)
      setTriggerError("Не вдалося підключитися до бекенду")
    }
  }

  const handlePause = async () => {
    try {
      await fetch("/api/admin/lpd/pause", { method: "POST" })
      await fetchLogs()
    } catch {}
  }

  const showLogs = scraping || liveLogs.length > 0

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#C9A84C]/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <Scale className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Правові позиції ВС</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">lpd.court.gov.ua — ~12 800 позицій</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {scraping && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              {pausing ? "Зупиняємось..." : "Виконується"}
            </span>
          )}
          {lastUpdated && (
            <span className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-widest hidden sm:block">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={fetchLogs}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl h-9"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Оновити</span>
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto py-5 space-y-4">

        {/* Info banner */}
        <div className="flex gap-3 p-4 rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/5 text-sm text-[#C9A84C]">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">Що скрапується</p>
            <p className="text-[#C9A84C]/80 text-xs sm:text-sm">
              Відформульовані <strong>правові позиції</strong> Верховного Суду — ВП, КАС, КЦС, ККС, КГС.
              Це квінтесенція судової практики: не сирі рішення, а вже сформульовані прецеденти.
              Джерело: <strong>lpd.court.gov.ua</strong> (~12 800 позицій, JSON API, без auth).
              Кожна позиція має категорію права, дату та номери справ.
            </p>
          </div>
        </div>

        {/* Resume alert */}
        {canResume && resumeProgress && !scraping && (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-blue-500/30 bg-blue-500/5">
            <div>
              <p className="text-sm font-semibold text-blue-400">Є збережений прогрес</p>
              <p className="text-xs text-blue-400/70 mt-0.5">
                Позиція {resumeProgress.next_index} / {resumeProgress.total} — збережено {new Date(resumeProgress.saved_at).toLocaleString("uk-UA")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleResume}
              className="gap-1.5 h-9 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 font-black uppercase tracking-wider text-[10px] shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Відновити
            </Button>
          </div>
        )}

        {/* Control + info cards */}
        <div className="grid gap-4 md:grid-cols-2">

          {/* Start / Pause card */}
          <div className={`bg-[#0d1120]/60 border rounded-2xl p-5 transition-all duration-200 ${
            scraping
              ? pausing ? "border-blue-500/30" : "border-amber-500/30"
              : "border-[#C9A84C]/10 hover:border-[#C9A84C]/20"
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Play className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-sm text-[#E0E6ED]">Ручний запуск</p>
                <p className="text-xs text-[#E0E6ED]/50 mt-0.5">Скрапінг усіх правових позицій ВС</p>
              </div>
            </div>

            <p className="text-sm text-[#E0E6ED]/70 mb-1">
              {scraping ? (pausing ? "Завершення поточного батчу..." : "Скрапінг виконується...") : "Готово до запуску"}
            </p>
            {triggerError && <p className="text-xs text-red-400 mb-2">{triggerError}</p>}
            {!triggerError && (
              <p className="text-xs text-[#E0E6ED]/40 mb-4">
                {scraping
                  ? "Новий запуск неможливий поки виконується поточний"
                  : "Завантажить ~12 800 позицій → laws_positions (~15–20 хв)"}
              </p>
            )}

            <div className="flex gap-2">
              {scraping && (
                <Button
                  size="sm" variant="ghost"
                  onClick={handlePause}
                  disabled={pausing}
                  className="gap-1.5 h-9 rounded-xl border border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10 text-blue-400 font-black uppercase tracking-wider text-[10px]"
                >
                  <Pause className="w-3.5 h-3.5" />
                  {pausing ? "Зупиняється..." : "Пауза"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleStart}
                disabled={scraping}
                className="gap-1.5 h-9 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#C9A84C]/10 disabled:opacity-40"
              >
                {scraping
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Виконується</>
                  : <><Play className="w-3.5 h-3.5" /> Запустити</>}
              </Button>
            </div>
          </div>

          {/* Info card */}
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center">
                <Scale className="w-4 h-4 text-[#C9A84C]" />
              </div>
              <div>
                <p className="font-semibold text-sm text-[#E0E6ED]">Про колекцію</p>
                <p className="text-xs text-[#E0E6ED]/50 mt-0.5 font-mono">laws_positions</p>
              </div>
            </div>
            <div className="space-y-2">
              {[
                ["Тип документів",  "Правові позиції ВС"],
                ["Суди",            "ВП, КАС, КЦС, ККС, КГС"],
                ["Джерело",         "lpd.court.gov.ua"],
                ["Формат",          "JSON API (без auth)"],
                ["Глибина архіву",  "з 2020 року"],
                ["Пріоритет",       "Найвищий (+10% над Радою)"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-xs text-[#E0E6ED]/50">{label}</span>
                  <span className="text-xs font-medium text-[#E0E6ED]/80">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Live logs */}
        {showLogs && (
          <div className={`bg-[#0d1120]/60 border rounded-2xl transition-all duration-200 ${scraping ? "border-amber-500/30" : "border-[#C9A84C]/10"}`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#C9A84C]/10">
              <div className="flex items-center gap-2">
                {scraping && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
                <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">
                  Лог поточного сеансу
                </p>
              </div>
              {scraping && (
                <span className="text-[10px] font-black text-amber-400/60 uppercase tracking-wider">
                  Оновлення кожні 5 сек
                </span>
              )}
            </div>
            <div className="p-5">
              <div className="bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 font-mono text-xs h-52 overflow-y-auto p-3 space-y-0.5">
                {liveLogs.length === 0 ? (
                  <p className="text-[#C9A84C]/50">Очікування логів...</p>
                ) : (
                  liveLogs.map((log, i) => (
                    <div key={i} className={`flex gap-2 ${logColor(log.level)}`}>
                      <span className="shrink-0 opacity-60 tabular-nums">
                        {new Date(log.ts).toLocaleTimeString("uk-UA")}
                      </span>
                      <span className="break-all">{log.message}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* History */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#C9A84C]/10">
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-[#C9A84C]/50" />
              <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">
                Історія синхронізацій
              </p>
            </div>
            <p className="text-[10px] text-[#E0E6ED]/30">Останні 20 запусків</p>
          </div>
          <div className="p-4">
            {history.length === 0 ? (
              <p className="text-sm text-[#E0E6ED]/30 py-6 text-center">
                Синхронізацій ще не було. Натисніть «Запустити» вище.
              </p>
            ) : (
              <div className="rounded-xl border border-[#C9A84C]/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#C9A84C]/10 bg-[#0A0E1A]/40">
                      <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider w-32">Статус</th>
                      <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider">Початок</th>
                      <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider hidden sm:table-cell">Кінець</th>
                      <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider w-24">Позицій</th>
                      <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider hidden md:table-cell">Повідомлення</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={h.id ?? i} className="border-b border-[#C9A84C]/5 last:border-0 hover:bg-[#C9A84C]/3 transition-colors">
                        <td className="px-4 py-3"><StatusBadge status={h.status} /></td>
                        <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs">
                          {h.started_at
                            ? new Date(h.started_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden sm:table-cell">
                          {h.finished_at
                            ? new Date(h.finished_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {h.laws_processed != null
                            ? <span className="font-serif font-bold text-[#C9A84C]">{h.laws_processed}</span>
                            : <span className="text-[#E0E6ED]/30">—</span>}
                        </td>
                        <td className="px-4 py-3 text-[#E0E6ED]/50 text-xs hidden md:table-cell max-w-[220px]">
                          <span className="truncate block">{h.error_message ?? "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
