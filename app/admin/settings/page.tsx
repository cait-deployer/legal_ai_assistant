"use client"

import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Settings, Play, Loader2, RefreshCw,
  CheckCircle, XCircle, Database, Scale, BookOpen, FileText,
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

type SourceState = {
  running: boolean
  logs: LogEntry[]
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0"><CheckCircle className="w-3 h-3" /> Успішно</span>
  if (status === "error")
    return <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0"><XCircle className="w-3 h-3" /> Помилка</span>
  if (status === "running")
    return <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0"><Loader2 className="w-3 h-3 animate-spin" /> Виконується</span>
  return <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-[#BFA071]/5 border border-[#BFA071]/10 text-[#BFA071]/70 shrink-0">{status}</span>
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
  },
  // {
  //   key: "templates",
  //   label: "Шаблони",
  //   description: "Офіційні шаблони документів з data.gov.ua",
  //   icon: FileText,
  //   iconColor: "text-amber-400",
  //   iconBg: "bg-amber-500/10 border border-amber-500/20",
  //   triggerUrl: "/api/admin/templates/trigger",
  //   logsUrl: "/api/admin/templates/logs",
  // },
]

function SourceCard({ source }: { source: typeof SOURCES[0] }) {
  const [state, setState] = useState<SourceState>({ running: false, logs: [] })
  const [error, setError] = useState("")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const Icon = source.icon

  const fetchLogs = async () => {
    try {
      const r = await fetch(source.logsUrl)
      const d = await r.json()
      setState({ running: d.running ?? false, logs: d.live_logs ?? [] })
    } catch { }
  }

  useEffect(() => { 
    const fetchInit = async () => {
      return fetchLogs()
    }
    fetchInit() }
    , [])

  useEffect(() => {
    if (state.running) {
      pollRef.current = setInterval(fetchLogs, 4000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state.running])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.logs])

  const handleRun = async () => {
    if (state.running) return
    setError("")
    setState((s) => ({ ...s, running: true }))
    try {
      const res = await fetch(source.triggerUrl, { method: "POST" })
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

  const logColor = (level: string) => {
    switch (level) {
      case "error": return "text-red-400"
      case "success": return "text-emerald-400"
      case "warning": return "text-amber-400"
      default: return "text-[#E0E6ED]/70"
    }
  }

  return (
    <div className={`bg-[#0d1120]/60 border rounded-2xl transition-all duration-200 ${state.running ? "border-amber-500/30" : "border-[#BFA071]/10 hover:border-[#BFA071]/20"}`}>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${source.iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${source.iconColor}`} />
            </div>
            <div>
              <p className="font-semibold text-[#E0E6ED] text-sm">{source.label}</p>
              <p className="text-xs text-[#E0E6ED]/70 mt-0.5">{source.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {state.running && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Виконується
              </span>
            )}
            <Button
              size="sm"
              onClick={handleRun}
              disabled={state.running}
              className="gap-1.5 h-9 rounded-xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#BFA071]/10 disabled:opacity-40"
            >
              {state.running
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Йде...</>
                : <><Play className="w-3.5 h-3.5" /> Запустити</>}
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>

      {(state.running || state.logs.length > 0) && (
        <div className="px-5 pb-5 pt-0">
          <div className="bg-[#0A0E1A]/80 rounded-xl border border-[#BFA071]/10 font-mono text-xs h-40 overflow-y-auto p-3 space-y-0.5">
            {state.logs.length === 0 ? (
              <p className="text-[#BFA071]/50">Очікування логів...</p>
            ) : (
              state.logs.map((log, i) => (
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
    } catch { }
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
                <span className="text-[10px] font-black text-[#BFA071]/50 uppercase tracking-widest">{lastUpdated.toLocaleTimeString()}</span>
              )}
            </div>
            <div className="p-5">
              {historyLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
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
                        <tr key={h.id ?? i} className="border-b border-[#BFA071]/5 last:border-0 hover:bg-[#BFA071]/3 transition-colors">
                          <td className="px-4 py-3"><StatusBadge status={h.status} /></td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs">
                            {h.started_at ? new Date(h.started_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden sm:table-cell">
                            {h.finished_at ? new Date(h.finished_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {h.laws_processed != null ? <span className="font-serif font-bold text-[#BFA071]">{h.laws_processed}</span> : <span className="text-[#E0E6ED]/30">—</span>}
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
