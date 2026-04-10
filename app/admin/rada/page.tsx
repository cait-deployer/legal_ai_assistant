"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Database, Clock, Play, Loader2, RefreshCw,
  CheckCircle, XCircle, Zap, Settings, BookOpen, List, X,
} from "lucide-react"
import { LawsListTab } from "./laws-list"

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
  return <Badge variant="secondary" className="shrink-0">{status}</Badge>
}

export default function RadaPage() {
  const [scheduleEnabled, setScheduleEnabled] = useState(true)
  const [scraping, setScraping] = useState(false)
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [triggerError, setTriggerError] = useState("")
  const logsEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Themes modal state ──────────────────────────────────────────────
  const [showThemesModal, setShowThemesModal] = useState(false)
  const [themes, setThemes] = useState<Theme[]>([])
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("/api/admin/rada/schedule")
      .then((r) => r.json())
      .then((d) => setScheduleEnabled(d.enabled ?? true))
      .catch(() => {})
  }, [])

  const fetchLogs = async () => {
    try {
      const r = await fetch("/api/admin/rada/logs")
      const d = await r.json()
      setScraping(d.running ?? false)
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

  const handleToggleSchedule = async () => {
    const next = !scheduleEnabled
    setScheduleEnabled(next)
    try {
      await fetch("/api/admin/rada/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
    } catch {}
  }

  const openThemesModal = async () => {
    if (scraping) return
    setTriggerError("")
    // Lazy-load themes from backend if not yet loaded
    if (themes.length === 0) {
      try {
        const res = await fetch("/api/admin/rada/themes")
        if (res.ok) setThemes(await res.json())
      } catch { /* ignore, modal still opens */ }
    }
    setSelectedCodes(new Set()) // start with none selected = scrape all
    setShowThemesModal(true)
  }

  const handleScrapeNow = async (sectionCodes: string[] | null) => {
    setShowThemesModal(false)
    setScraping(true)
    try {
      const res = await fetch("/api/admin/rada/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section_codes: sectionCodes }),
      })
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

  const toggleTheme = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
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
      {/* ── page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl shrink-0">
            <Database className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">РАДА</h1>
            <p className="text-lg text-muted-foreground mt-1">
              Синхронізація законів з zakon.rada.gov.ua
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {scraping ? (
            <Badge variant="outline" className="gap-1.5 text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
              <Loader2 className="w-3 h-3 animate-spin" /> Виконується
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

      {/* ── tabs ── */}
      <Tabs defaultValue="settings" className="flex-1 flex flex-col mt-5 min-h-0">
        <TabsList variant="line" className="shrink-0">
          <TabsTrigger value="settings" className="gap-2 px-4">
            <Settings className="w-4 h-4" /> Налаштування
          </TabsTrigger>
          <TabsTrigger value="laws" className="gap-2 px-4">
            <BookOpen className="w-4 h-4" /> База законів
          </TabsTrigger>
        </TabsList>

        {/* ── settings tab ── */}
        <TabsContent value="settings" className="flex-1 overflow-y-auto min-h-0">
          <div className="space-y-6 pt-6">

            {/* control cards */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* schedule */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    Автоскрапінг вночі
                  </CardTitle>
                  <CardDescription>Автоматична синхронізація щодня о 01:00</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        {scheduleEnabled ? "Увімкнено" : "Вимкнено"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {scheduleEnabled
                          ? "Наступний запуск: сьогодні/завтра о 01:00"
                          : "Автоматичний запуск призупинено"}
                      </p>
                    </div>
                    <button
                      onClick={handleToggleSchedule}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        scheduleEnabled ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                      aria-checked={scheduleEnabled}
                      role="switch"
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                          scheduleEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* manual trigger */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-500" />
                    Ручний запуск
                  </CardTitle>
                  <CardDescription>Запустити скрапінг прямо зараз</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        {scraping ? "Скрапінг виконується..." : "Готово до запуску"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {triggerError
                          ? <span className="text-destructive">{triggerError}</span>
                          : "Завантажить нові закони з РАДА до бази"}
                      </p>
                    </div>
                    <Button onClick={openThemesModal} disabled={scraping} className="gap-2 shrink-0">
                      {scraping
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Виконується</>
                        : <><List className="w-4 h-4" /> Вибрати теми</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* live logs */}
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

            {/* history */}
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="w-4 h-4 text-primary" />
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
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Законів</th>
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
        </TabsContent>

        {/* ── laws tab ── */}
        <TabsContent value="laws" className="flex-1 min-h-0 overflow-hidden">
          <LawsListTab />
        </TabsContent>
      </Tabs>

      {/* ── Themes selection modal ─────────────────────────────────────── */}
      {showThemesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowThemesModal(false)} />
          <div className="relative w-full max-w-2xl bg-background border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div>
                <h2 className="font-semibold text-lg">Вибір розділів для скрапінгу</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Оберіть теми або залиште порожнім щоб скрапити всі дефолтні розділи
                </p>
              </div>
              <button onClick={() => setShowThemesModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Select all / none */}
            <div className="flex gap-3 px-6 py-3 border-b shrink-0">
              <button
                onClick={() => setSelectedCodes(new Set(themes.map(t => t.code)))}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Вибрати всі
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                onClick={() => setSelectedCodes(new Set())}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Зняти всі
              </button>
              {selectedCodes.size > 0 && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Вибрано: {selectedCodes.size} / {themes.length}
                </span>
              )}
            </div>

            {/* Themes list */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {themes.length === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Завантаження тем...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {themes.map(t => (
                    <label
                      key={t.code}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        selectedCodes.has(t.code)
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:border-primary/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCodes.has(t.code)}
                        onChange={() => toggleTheme(t.code)}
                        className="accent-primary shrink-0"
                      />
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-8">{t.code}</span>
                      <span className="text-xs leading-tight">{t.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex gap-3 px-6 py-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setShowThemesModal(false)} className="flex-1">
                Скасувати
              </Button>
              <Button
                onClick={() => handleScrapeNow(selectedCodes.size > 0 ? [...selectedCodes] : null)}
                className="flex-1 gap-2"
              >
                <Play className="w-4 h-4" />
                {selectedCodes.size === 0
                  ? "Запустити всі розділи"
                  : `Запустити (${selectedCodes.size} тем)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}