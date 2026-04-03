"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, FileText, Clock,
  CheckCircle, XCircle, Loader2, RefreshCw,
  ArrowRight, Zap, Calendar, Settings, BookOpen,
} from "lucide-react"

type Stats = {
  doc_count: number
  last_sync: {
    status: string
    started_at: string
    finished_at?: string
    laws_processed?: number
    error_message?: string
  } | null
  schedule_enabled: boolean
  scraping_running: boolean
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [scheduleToggling, setScheduleToggling] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchStats = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/stats")
      const data = await res.json()
      setStats(data)
      setLastUpdated(new Date())
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { fetchStats() }, [])

  const handleToggleSchedule = async () => {
    if (!stats || scheduleToggling) return
    const next = !stats.schedule_enabled
    setScheduleToggling(true)
    try {
      await fetch("/api/admin/rada/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      setStats((s) => s ? { ...s, schedule_enabled: next } : s)
    } catch {}
    finally { setScheduleToggling(false) }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl shrink-0">
            <LayoutDashboard className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Дашборд</h1>
            <p className="text-lg text-muted-foreground mt-1">Огляд системи Lawyer AI</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              Оновлено {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Doc count */}
        <Card className="hover:border-primary/40 hover:shadow-sm transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Документів у базі</CardTitle>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" />
            ) : (
              <div className="text-3xl font-bold tabular-nums">
                {stats?.doc_count?.toLocaleString() ?? "—"}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">Векторних чанків у Supabase</p>
          </CardContent>
        </Card>

        {/* Schedule toggle */}
        <Card className="hover:border-primary/40 hover:shadow-sm transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Автосинхронізація</CardTitle>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full transition-colors ${stats?.schedule_enabled ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                    <span className="text-xl font-bold">
                      {stats?.schedule_enabled ? "Увімкнено" : "Вимкнено"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">Щодня о 01:00</p>
                </div>
                <button
                  onClick={handleToggleSchedule}
                  disabled={scheduleToggling}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 ${
                    stats?.schedule_enabled ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                  role="switch"
                  aria-checked={stats?.schedule_enabled}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
                    stats?.schedule_enabled ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scraping status */}
        <Card className="hover:border-primary/40 hover:shadow-sm transition-all duration-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground">Статус скрапінгу</CardTitle>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {loading ? (
              <div className="h-9 w-24 rounded-lg bg-muted animate-pulse" />
            ) : stats?.scraping_running ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span className="text-xl font-bold text-amber-500">Виконується</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xl font-bold">Очікування</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1.5">Поточний стан синхронізації</p>
          </CardContent>
        </Card>
      </div>

      {/* Last sync */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="w-4 h-4 text-primary" /> Остання синхронізація
              </CardTitle>
              <CardDescription className="mt-0.5">Результат останнього запуску скрапінгу</CardDescription>
            </div>
            <Link href="/admin/settings">
              <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs text-muted-foreground hover:text-foreground">
                Керувати <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <div className="h-4 w-48 rounded bg-muted animate-pulse" />
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
            </div>
          ) : !stats?.last_sync ? (
            <p className="text-sm text-muted-foreground py-2">Синхронізацій ще не було.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex items-center gap-2">
                {stats.last_sync.status === "success" && (
                  <Badge variant="outline" className="gap-1 text-green-500 border-green-500/30 bg-green-50 dark:bg-green-950/20">
                    <CheckCircle className="w-3 h-3" /> Успішно
                  </Badge>
                )}
                {stats.last_sync.status === "error" && (
                  <Badge variant="outline" className="gap-1 text-destructive border-destructive/30 bg-destructive/10">
                    <XCircle className="w-3 h-3" /> Помилка
                  </Badge>
                )}
                {stats.last_sync.status === "running" && (
                  <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
                    <Loader2 className="w-3 h-3 animate-spin" /> Виконується
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <span className="font-medium text-foreground">Початок:</span>{" "}
                  {new Date(stats.last_sync.started_at).toLocaleString("uk-UA")}
                </p>
                {stats.last_sync.finished_at && (
                  <p>
                    <span className="font-medium text-foreground">Кінець:</span>{" "}
                    {new Date(stats.last_sync.finished_at).toLocaleString("uk-UA")}
                  </p>
                )}
                {stats.last_sync.laws_processed != null && (
                  <p>
                    <span className="font-medium text-foreground">Оброблено:</span>{" "}
                    {stats.last_sync.laws_processed} законів
                  </p>
                )}
                {stats.last_sync.error_message && (
                  <p className="text-destructive">{stats.last_sync.error_message}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <Card className="border-dashed">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm">Швидкі дії</p>
              <p className="text-xs text-muted-foreground mt-0.5">Перейдіть до потрібного розділу</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/settings">
                <Button variant="outline" size="sm" className="gap-2 h-9">
                  <Settings className="w-4 h-4" /> Налаштування
                </Button>
              </Link>
              <Link href="/admin/base">
                <Button variant="outline" size="sm" className="gap-2 h-9">
                  <BookOpen className="w-4 h-4" /> База знань
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" size="sm" className="gap-2 h-9">
                  <FileText className="w-4 h-4" /> Відкрити чат
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}