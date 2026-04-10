"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Scale, Play, Pause, Loader2, RefreshCw,
  CheckCircle, XCircle, Info,
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

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30 bg-green-50 dark:bg-green-950/20 shrink-0">
        <CheckCircle className="w-3 h-3" /> Успішно
      </Badge>
    )
  if (status === "error")
    return (
      <Badge variant="outline" className="gap-1 text-destructive border-destructive/30 bg-destructive/10 shrink-0">
        <XCircle className="w-3 h-3" /> Помилка
      </Badge>
    )
  if (status === "running")
    return (
      <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" /> Виконується
      </Badge>
    )
  if (status === "paused")
    return (
      <Badge variant="outline" className="gap-1 text-blue-500 border-blue-500/30 bg-blue-50 dark:bg-blue-950/20 shrink-0">
        <Pause className="w-3 h-3" /> Призупинено
      </Badge>
    )
  return <Badge variant="secondary" className="shrink-0">{status}</Badge>
}

export default function CcuPage() {
  const [scraping, setScraping]     = useState(false)
  const [pausing, setPausing]       = useState(false)
  const [liveLogs, setLiveLogs]     = useState<LogEntry[]>([])
  const [history, setHistory]       = useState<HistoryEntry[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [triggerError, setTriggerError] = useState("")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = async () => {
    try {
      const r = await fetch("/api/admin/ccu/logs")
      const d = await r.json()
      setScraping(d.running ?? false)
      setPausing(d.pause_requested ?? false)
      setLiveLogs(d.live_logs ?? [])
      setHistory(d.history ?? [])
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
      const res = await fetch("/api/admin/ccu/trigger", { method: "POST" })
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

  const handlePause = async () => {
    try {
      await fetch("/api/admin/ccu/pause", { method: "POST" })
      await fetchLogs()
    } catch {}
  }

  const logLevelColor = (level: string) => {
    switch (level) {
      case "error":   return "text-destructive"
      case "success": return "text-green-500"
      case "warning": return "text-amber-500"
      default:        return "text-muted-foreground"
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl shrink-0">
            <Scale className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">КСУ</h1>
            <p className="text-lg text-muted-foreground mt-1">
              Рішення та Висновки Конституційного Суду України
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {scraping ? (
            <Badge variant="outline" className="gap-1.5 text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
              <Loader2 className="w-3 h-3 animate-spin" />
              {pausing ? "Завершення поточного..." : "Виконується"}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 text-green-500 border-green-500/30 bg-green-50 dark:bg-green-950/20">
              <div className="w-2 h-2 rounded-full bg-green-500" /> Очікування
            </Badge>
          )}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Оновити
          </Button>
        </div>
      </div>

      <div className="space-y-6 pt-6 overflow-y-auto flex-1">

        {/* Info banner */}
        <div className="flex gap-3 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 text-sm text-blue-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Що скрапується</p>
            <p className="text-blue-400/80">
              Тільки <strong>Рішення</strong> (-р) та <strong>Висновки</strong> (-в) КСУ.
              Ухвали про відмову або подовження строку автоматично пропускаються.
              Джерело: ccu.gov.ua/docs-search (~342 сторінки, з 1997 року).
            </p>
          </div>
        </div>

        {/* Control cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Start/Pause */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="w-5 h-5 text-amber-500" />
                Ручний запуск
              </CardTitle>
              <CardDescription>Скрапінг усіх рішень та висновків КСУ</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    {scraping ? (pausing ? "Завершення документа..." : "Скрапінг виконується...") : "Готово до запуску"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {triggerError
                      ? <span className="text-destructive">{triggerError}</span>
                      : scraping
                        ? "Новий запуск неможливий поки виконується поточний"
                        : "Завантажить рішення та висновки КСУ до laws_ccu"}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {scraping && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePause}
                      disabled={pausing}
                      className="gap-2"
                    >
                      <Pause className="w-4 h-4" />
                      {pausing ? "Зупиняється..." : "Пауза"}
                    </Button>
                  )}
                  <Button onClick={handleStart} disabled={scraping} className="gap-2">
                    {scraping
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Виконується</>
                      : <><Play className="w-4 h-4" /> Запустити</>}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-primary" />
                Про колекцію
              </CardTitle>
              <CardDescription>laws_ccu в Qdrant</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Тип документів</span>
                <span className="font-medium">Рішення + Висновки КСУ</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Джерело</span>
                <span className="font-mono text-xs">ccu.gov.ua</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Формат файлів</span>
                <span className="font-medium">PDF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Глибина архіву</span>
                <span className="font-medium">з 1997 року</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live logs */}
        {(scraping || liveLogs.length > 0) && (
          <Card className={scraping ? "border-amber-500/30" : ""}>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {scraping && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
                  Лог поточного сеансу
                </CardTitle>
                {scraping && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 text-xs">
                    Оновлення кожні 5 сек
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-xl border font-mono text-xs h-64 overflow-y-auto p-3 space-y-1">
                {liveLogs.length === 0 ? (
                  <p className="text-muted-foreground">Очікування логів...</p>
                ) : (
                  liveLogs.map((log, i) => (
                    <div key={i} className={`flex gap-2 ${logLevelColor(log.level)}`}>
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
          </Card>
        )}

        {/* History */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="w-4 h-4 text-primary" />
              Історія синхронізацій
            </CardTitle>
            <CardDescription>Останні 20 запусків</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Синхронізацій ще не було. Натисніть «Запустити» вище.
              </p>
            ) : (
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Статус</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Початок</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Кінець</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Документів</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Повідомлення</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={h.id ?? i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3"><StatusBadge status={h.status} /></td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {h.started_at
                            ? new Date(h.started_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                          {h.finished_at
                            ? new Date(h.finished_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })
                            : "—"}
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
      </div>
    </div>
  )
}
