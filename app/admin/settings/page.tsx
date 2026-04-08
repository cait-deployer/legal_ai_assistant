"use client"

import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Settings, Play, Pause, RotateCcw, Loader2, RefreshCw,
  CheckCircle, XCircle, Database, Scale, BookOpen, List, X,
} from "lucide-react"

type Theme = { code: string; label: string }

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

type SourceState = {
  running: boolean
  pause_requested: boolean
  can_resume: boolean
  resume_progress?: { next_index: number; total: number } | null
  logs: LogEntry[]
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
    <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-[#BFA071]/5 border border-[#BFA071]/10 text-[#BFA071]/70 shrink-0">
      {status}
    </span>
  )
}

const SOURCES = [
  {
    key: "rada",
    label: "РАДА",
    description: "Закони з zakon.rada.gov.ua",
    icon: Database,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/10 border border-blue-500/20",
    triggerUrl: "/api/admin/rada/trigger",
    logsUrl: "/api/admin/rada/logs",
    pauseUrl: "/api/admin/rada/pause",
    resumeUrl: "/api/admin/rada/resume",
    supportsPause: true,
  },
  {
    key: "supreme",
    label: "Верховний Суд",
    description: "PDF-огляди з supreme.court.gov.ua",
    icon: Scale,
    iconColor: "text-purple-400",
    iconBg: "bg-purple-500/10 border border-purple-500/20",
    triggerUrl: "/api/admin/supreme/trigger",
    logsUrl: "/api/admin/supreme/logs",
    pauseUrl: null,
    resumeUrl: null,
    supportsPause: false,
  },
  {
    key: "wiki",
    label: "Wiki",
    description: "Роз'яснення з legalaid.wiki",
    icon: BookOpen,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border border-emerald-500/20",
    triggerUrl: "/api/admin/wiki/trigger",
    logsUrl: "/api/admin/wiki/logs",
    pauseUrl: null,
    resumeUrl: null,
    supportsPause: false,
  },
]

function logColor(level: string) {
  switch (level) {
    case "error":   return "text-red-400"
    case "success": return "text-emerald-400"
    case "warning": return "text-amber-400"
    default:        return "text-[#E0E6ED]/70"
  }
}

function SourceCard({ source }: { source: typeof SOURCES[0] }) {
  const [state, setState] = useState<SourceState>({
    running: false,
    pause_requested: false,
    can_resume: false,
    resume_progress: null,
    logs: [],
  })
  const [error, setError] = useState("")
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const Icon = source.icon

  // Themes modal (only for Rada)
  const [showThemesModal, setShowThemesModal] = useState(false)
  const [themes, setThemes] = useState<Theme[]>([])
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())

  const fetchLogs = async () => {
    try {
      const r = await fetch(source.logsUrl)
      const d = await r.json()
      setState({
        running: d.running ?? false,
        pause_requested: d.pause_requested ?? false,
        can_resume: d.can_resume ?? false,
        resume_progress: d.resume_progress ?? null,
        logs: d.live_logs ?? [],
      })
    } catch { /* silently ignore network errors */ }
  }

  useEffect(() => { 
    const fetchData = async () => {
      return await fetchLogs()
    }
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state.running) {
      pollRef.current = setInterval(fetchLogs, 3000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state.running])

  useEffect(() => {
    const el = logsContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs])

  const openRunModal = async () => {
    if (state.running) return
    if (source.key !== "rada") { handleRun(null); return }
    setError("")
    if (themes.length === 0) {
      try {
        const r = await fetch("/backend/admin/rada/themes")
        if (r.ok) setThemes(await r.json())
      } catch { /* show modal anyway */ }
    }
    setSelectedCodes(new Set())
    setShowThemesModal(true)
  }

  const handleRun = async (sectionCodes: string[] | null) => {
    setShowThemesModal(false)
    if (state.running) return
    setError("")
    setState((s) => ({ ...s, running: true, logs: [], can_resume: false }))
    try {
      const isRada = source.key === "rada"
      const res = await fetch(source.triggerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: isRada ? JSON.stringify({ section_codes: sectionCodes }) : "{}",
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка запуску")
        setState((s) => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setError("Не вдалося підключитися до бекенду")
      setState((s) => ({ ...s, running: false }))
    }
  }

  const toggleTheme = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  const handlePause = async () => {
    if (!source.pauseUrl) return
    setError("")
    try {
      await fetch(source.pauseUrl, { method: "POST" })
      setState((s) => ({ ...s, pause_requested: true }))
    } catch {
      setError("Не вдалося надіслати команду паузи")
    }
  }

  const handleResume = async () => {
    if (!source.resumeUrl) return
    setError("")
    setState((s) => ({ ...s, running: true, can_resume: false }))
    try {
      const res = await fetch(source.resumeUrl, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка відновлення")
        setState((s) => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setError("Не вдалося підключитися до бекенду")
      setState((s) => ({ ...s, running: false }))
    }
  }

  const showLogs = state.running || state.logs.length > 0

  return (
    <div
      className={`bg-[#0d1120]/60 border rounded-2xl transition-all duration-200 ${
        state.running
          ? state.pause_requested
            ? "border-blue-500/30"
            : "border-amber-500/30"
          : state.can_resume
          ? "border-blue-500/20"
          : "border-[#BFA071]/10 hover:border-[#BFA071]/20"
      }`}
    >
      <div className="p-5">
        {/* Top row: icon + name + actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${source.iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${source.iconColor}`} />
            </div>
            <div>
              <p className="font-semibold text-[#E0E6ED] text-sm">{source.label}</p>
              <p className="text-xs text-[#E0E6ED]/70 mt-0.5">{source.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Status badge */}
            {state.running && state.pause_requested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Зупиняємось...
              </span>
            )}
            {state.running && !state.pause_requested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Виконується
              </span>
            )}

            {/* Pause button (only while running, before pause is requested) */}
            {source.supportsPause && state.running && !state.pause_requested && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handlePause}
                className="gap-1.5 h-9 rounded-xl border border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10 text-blue-400 font-black uppercase tracking-wider text-[10px]"
              >
                <Pause className="w-3.5 h-3.5" /> Пауза
              </Button>
            )}

            {/* Resume button (when paused and not running) */}
            {source.supportsPause && !state.running && state.can_resume && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResume}
                className="gap-1.5 h-9 rounded-xl border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-emerald-400 font-black uppercase tracking-wider text-[10px]"
              >
                <Play className="w-3.5 h-3.5" /> Відновити
              </Button>
            )}

            {/* Start / restart button */}
            <Button
              size="sm"
              onClick={openRunModal}
              disabled={state.running}
              className="gap-1.5 h-9 rounded-xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#BFA071]/10 disabled:opacity-40"
            >
              {state.running ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Йде...</>
              ) : state.can_resume ? (
                <><RotateCcw className="w-3.5 h-3.5" /> З початку</>
              ) : source.key === "rada" ? (
                <><List className="w-3.5 h-3.5" /> Вибрати теми</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Запустити</>
              )}
            </Button>
          </div>
        </div>

        {/* Resume progress bar */}
        {source.supportsPause && state.can_resume && state.resume_progress && (
          <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider">
                Збережений прогрес
              </span>
              <span className="text-[10px] font-mono text-blue-400">
                {state.resume_progress.next_index} / {state.resume_progress.total} законів
              </span>
            </div>
            <div className="w-full bg-[#0A0E1A] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-400 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(
                    (state.resume_progress.next_index / state.resume_progress.total) * 100
                  )}%`,
                }}
              />
            </div>
            <p className="text-[10px] text-[#E0E6ED]/50 mt-1.5">
              Натисніть «Відновити» щоб продовжити з місця зупинки,
              або «З початку» щоб почати заново.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>

      {/* Themes modal (Rada only) */}
      {showThemesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowThemesModal(false)} />
          <div className="relative w-full max-w-2xl bg-[#0d1120] border border-[#BFA071]/30 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#BFA071]/10 shrink-0">
              <div>
                <h2 className="font-semibold text-[#E0E6ED]">Вибір розділів для скрапінгу</h2>
                <p className="text-xs text-[#E0E6ED]/50 mt-0.5">Залиште порожнім щоб скрапити всі дефолтні розділи</p>
              </div>
              <button onClick={() => setShowThemesModal(false)} className="text-[#BFA071]/50 hover:text-[#BFA071]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-3 px-6 py-3 border-b border-[#BFA071]/10 shrink-0">
              <button onClick={() => setSelectedCodes(new Set(themes.map(t => t.code)))} className="text-xs font-semibold text-[#BFA071] hover:underline">Вибрати всі</button>
              <span className="text-[#BFA071]/30">·</span>
              <button onClick={() => setSelectedCodes(new Set())} className="text-xs font-semibold text-[#BFA071] hover:underline">Зняти всі</button>
              {selectedCodes.size > 0 && <span className="text-xs text-[#E0E6ED]/40 ml-auto">Вибрано: {selectedCodes.size} / {themes.length}</span>}
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {themes.length === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2 text-[#E0E6ED]/40">
                  <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Завантаження...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {themes.map(t => (
                    <label key={t.code} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${selectedCodes.has(t.code) ? "border-[#BFA071]/50 bg-[#BFA071]/5" : "border-[#BFA071]/10 hover:border-[#BFA071]/30"}`}>
                      <input type="checkbox" checked={selectedCodes.has(t.code)} onChange={() => toggleTheme(t.code)} className="accent-[#BFA071] shrink-0" />
                      <span className="font-mono text-[10px] text-[#BFA071]/40 shrink-0 w-8">{t.code}</span>
                      <span className="text-xs text-[#E0E6ED]/80 leading-tight">{t.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-[#BFA071]/10 shrink-0">
              <Button variant="outline" onClick={() => setShowThemesModal(false)} className="flex-1 border-[#BFA071]/20 text-[#E0E6ED]/60 hover:text-[#E0E6ED]">Скасувати</Button>
              <Button onClick={() => handleRun(selectedCodes.size > 0 ? [...selectedCodes] : null)} className="flex-1 gap-2 bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black">
                <Play className="w-4 h-4" />
                {selectedCodes.size === 0 ? "Всі розділи" : `Запустити (${selectedCodes.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live log terminal */}
      {showLogs && (
        <div className="px-5 pb-5 pt-0">
          <div className="bg-[#0A0E1A]/80 rounded-xl border border-[#BFA071]/10 font-mono text-xs h-48 overflow-y-auto p-3 space-y-0.5">
            {state.logs.length === 0 ? (
              <p className="text-[#BFA071]/50">Очікування логів...</p>
            ) : (
              state.logs.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${logColor(entry.level)}`}>
                  <span className="shrink-0 opacity-60 tabular-nums">
                    {new Date(entry.ts).toLocaleTimeString("uk-UA")}
                  </span>
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logsContainerRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const r = await fetch("/api/admin/rada/logs")
      const d = await r.json()
      setHistory(d.history ?? [])
      setLastUpdated(new Date())
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  useEffect(() => { fetchHistory() }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#BFA071]/10 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#BFA071]/10 border border-[#BFA071]/20 rounded-2xl shrink-0">
            <Settings className="w-8 h-8 text-[#BFA071]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Налаштування</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Керування джерелами та синхронізацією</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchHistory}
          disabled={historyLoading}
          className="gap-2 border border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl shrink-0"
        >
          {historyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Оновити
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">
        {/* Sources */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">
            Джерела даних
          </h2>
          <div className="space-y-3">
            {SOURCES.map((src) => (
              <SourceCard key={src.key} source={src} />
            ))}
          </div>
        </section>

        {/* History */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">
            Історія синхронізацій
          </h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#BFA071]/10">
              <p className="text-sm text-[#E0E6ED]/70">Останні 20 запусків</p>
              {lastUpdated && (
                <span className="text-[10px] font-black text-[#BFA071]/50 uppercase tracking-widest">
                  {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="p-5">
              {historyLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 rounded-xl bg-[#BFA071]/5 animate-pulse" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-[#E0E6ED]/30 py-6 text-center">
                  Синхронізацій ще не було.
                </p>
              ) : (
                <div className="rounded-xl border border-[#BFA071]/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#BFA071]/10 bg-[#0A0E1A]/40">
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider w-32">Статус</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider">Початок</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider hidden sm:table-cell">Кінець</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider w-24">Законів</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider hidden md:table-cell">Повідомлення</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr
                          key={h.id ?? i}
                          className="border-b border-[#BFA071]/5 last:border-0 hover:bg-[#BFA071]/3 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <StatusBadge status={h.status} />
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs">
                            {h.started_at
                              ? new Date(h.started_at).toLocaleString("uk-UA", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden sm:table-cell">
                            {h.finished_at
                              ? new Date(h.finished_at).toLocaleString("uk-UA", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {h.laws_processed != null ? (
                              <span className="font-serif font-bold text-[#BFA071]">
                                {h.laws_processed}
                              </span>
                            ) : (
                              <span className="text-[#E0E6ED]/30">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden md:table-cell max-w-[220px]">
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
        </section>
      </div>
    </div>
  )
}
