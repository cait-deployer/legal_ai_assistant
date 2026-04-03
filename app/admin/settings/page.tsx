"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
    return <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30 bg-green-50 dark:bg-green-950/20 shrink-0"><CheckCircle className="w-3 h-3" /> Успішно</Badge>
  if (status === "error")
    return <Badge variant="outline" className="gap-1 text-destructive border-destructive/30 bg-destructive/10 shrink-0"><XCircle className="w-3 h-3" /> Помилка</Badge>
  if (status === "running")
    return <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 shrink-0"><Loader2 className="w-3 h-3 animate-spin" /> Виконується</Badge>
  return <Badge variant="secondary" className="shrink-0">{status}</Badge>
}

const SOURCES = [
  {
    key: "rada",
    label: "РАДА",
    description: "Закони з zakon.rada.gov.ua",
    icon: Database,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    triggerUrl: "/api/admin/rada/trigger",
    logsUrl: "/api/admin/rada/logs",
  },
  {
    key: "supreme",
    label: "Верховний Суд",
    description: "PDF-огляди з supreme.court.gov.ua",
    icon: Scale,
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/20",
    triggerUrl: "/api/admin/supreme/trigger",
    logsUrl: "/api/admin/supreme/logs",
  },
  {
    key: "wiki",
    label: "Wiki",
    description: "Роз'яснення з legalaid.wiki",
    icon: BookOpen,
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950/20",
    triggerUrl: "/api/admin/wiki/trigger",
    logsUrl: "/api/admin/wiki/logs",
  },
  {
    key: "templates",
    label: "Шаблони",
    description: "Офіційні шаблони документів з data.gov.ua",
    icon: FileText,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/20",
    triggerUrl: "/api/admin/templates/trigger",
    logsUrl: "/api/admin/templates/logs",
  },
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
    } catch {}
  }

  useEffect(() => { fetchLogs() }, [])

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
      case "error":   return "text-destructive"
      case "success": return "text-green-500"
      case "warning": return "text-amber-500"
      default:        return "text-muted-foreground"
    }
  }

  return (
    <Card className={state.running ? "border-amber-500/40" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${source.bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4.5 h-4.5 ${source.color}`} />
            </div>
            <div>
              <CardTitle className="text-base">{source.label}</CardTitle>
              <CardDescription className="text-xs mt-0.5">{source.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {state.running && (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 text-xs gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Виконується
              </Badge>
            )}
            <Button
              size="sm"
              onClick={handleRun}
              disabled={state.running}
              className="gap-1.5 h-8"
            >
              {state.running
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Йде...</>
                : <><Play className="w-3.5 h-3.5" /> Запустити</>}
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      </CardHeader>

      {(state.running || state.logs.length > 0) && (
        <CardContent className="pt-0">
          <div className="bg-muted/30 rounded-xl border font-mono text-xs h-40 overflow-y-auto p-3 space-y-0.5">
            {state.logs.length === 0 ? (
              <p className="text-muted-foreground">Очікування логів...</p>
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
        </CardContent>
      )}
    </Card>
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
    } catch {}
    finally { setHistoryLoading(false) }
  }

  useEffect(() => { fetchHistory() }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl shrink-0">
            <Settings className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Налаштування</h1>
            <p className="text-lg text-muted-foreground mt-1">Керування джерелами та синхронізацією</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHistory} disabled={historyLoading} className="gap-2 shrink-0">
          {historyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Оновити
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">
        {/* Sources */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Джерела даних
          </h2>
          <div className="space-y-4">
            {SOURCES.map((src) => (
              <SourceCard key={src.key} source={src} />
            ))}
          </div>
        </section>

        {/* History */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Історія синхронізацій
          </h2>
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardDescription>Останні 20 запусків</CardDescription>
                {lastUpdated && (
                  <span className="text-xs text-muted-foreground">{lastUpdated.toLocaleTimeString()}</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="space-y-2 pt-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Синхронізацій ще не було.
                </p>
              ) : (
                <div className="rounded-xl border overflow-hidden mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Статус</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Початок</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Кінець</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Законів</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Повідомлення</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={h.id ?? i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3"><StatusBadge status={h.status} /></td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {h.started_at ? new Date(h.started_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                            {h.finished_at ? new Date(h.finished_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {h.laws_processed != null ? <span className="font-semibold">{h.laws_processed}</span> : "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-[220px]">
                            <span className="truncate block">{h.error_message ?? "—"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}