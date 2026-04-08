"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
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
    } catch { }
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
    } catch { }
    finally { setScheduleToggling(false) }
  }

  return (
    <div className="space-y-6 py-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#BFA071]/10">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#BFA071]/10 border border-[#BFA071]/20 rounded-2xl shrink-0">
            <LayoutDashboard className="w-8 h-8 text-[#BFA071]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Дашборд</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Огляд системи URAI</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <p className="text-[10px] font-black text-[#BFA071]/50 uppercase tracking-widest hidden sm:block">
              Оновлено {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
            className="gap-2 border border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Doc count */}
        <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 hover:border-[#BFA071]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em]">Документів у базі</p>
            <div className="w-9 h-9 rounded-xl bg-[#BFA071]/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-[#BFA071]" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#BFA071]/5 animate-pulse" />
          ) : (
            <div className="text-4xl font-serif font-bold text-white tabular-nums">
              {stats?.doc_count?.toLocaleString() ?? "—"}
            </div>
          )}
          <p className="text-xs text-[#BFA071]/50 mt-2 font-medium uppercase tracking-wider">Векторних чанків у Supabase</p>
        </div>

        {/* Schedule toggle */}
        <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 hover:border-[#BFA071]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em]">Автосинхронізація</p>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#BFA071]/5 animate-pulse" />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${stats?.schedule_enabled ? "bg-emerald-400" : "bg-[#BFA071]/20"}`} />
                  <span className="text-xl font-serif font-bold text-white">
                    {stats?.schedule_enabled ? "Увімкнено" : "Вимкнено"}
                  </span>
                </div>
                <p className="text-[10px] text-[#BFA071]/50 mt-1.5 font-black uppercase tracking-wider">Щодня о 01:00</p>
              </div>
              <button
                onClick={handleToggleSchedule}
                disabled={scheduleToggling}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-60 ${stats?.schedule_enabled ? "bg-[#BFA071]" : "bg-[#BFA071]/20"
                  }`}
                role="switch"
                aria-checked={stats?.schedule_enabled}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${stats?.schedule_enabled ? "translate-x-6" : "translate-x-1"
                  }`} />
              </button>
            </div>
          )}
        </div>

        {/* Scraping status */}
        <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 hover:border-[#BFA071]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em]">Статус скрапінгу</p>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#BFA071]/5 animate-pulse" />
          ) : stats?.scraping_running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span className="text-xl font-serif font-bold text-amber-400">Виконується</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="text-xl font-serif font-bold text-white">Очікування</span>
            </div>
          )}
          <p className="text-[10px] text-[#BFA071]/50 mt-2 font-black uppercase tracking-wider">Поточний стан синхронізації</p>
        </div>
      </div>

      {/* Last sync */}
      <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-[2rem] p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#BFA071]" />
              <h2 className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em]">Остання синхронізація</h2>
            </div>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Результат останнього запуску скрапінгу</p>
          </div>
          <Link href="/admin/settings">
            <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs text-[#BFA071]/70 hover:text-[#BFA071] hover:bg-[#BFA071]/5 rounded-xl">
              Керувати <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 w-48 rounded bg-[#BFA071]/5 animate-pulse" />
            <div className="h-4 w-32 rounded bg-[#BFA071]/5 animate-pulse" />
          </div>
        ) : !stats?.last_sync ? (
          <p className="text-sm text-[#E0E6ED]/70 py-2">Синхронізацій ще не було.</p>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex items-center gap-2">
              {stats.last_sync.status === "success" && (
                <Badge className="gap-1 text-emerald-400 border-emerald-500/30 bg-emerald-500/10 rounded-xl">
                  <CheckCircle className="w-3 h-3" /> Успішно
                </Badge>
              )}
              {stats.last_sync.status === "error" && (
                <Badge className="gap-1 text-red-400 border-red-500/30 bg-red-500/10 rounded-xl">
                  <XCircle className="w-3 h-3" /> Помилка
                </Badge>
              )}
              {stats.last_sync.status === "running" && (
                <Badge className="gap-1 text-amber-400 border-amber-500/30 bg-amber-500/10 rounded-xl">
                  <Loader2 className="w-3 h-3 animate-spin" /> Виконується
                </Badge>
              )}
            </div>
            <div className="text-sm text-[#E0E6ED]/70 space-y-1">
              <p>
                <span className="font-medium text-[#BFA071]/60">Початок:</span>{" "}
                {new Date(stats.last_sync.started_at).toLocaleString("uk-UA")}
              </p>
              {stats.last_sync.finished_at && (
                <p>
                  <span className="font-medium text-[#BFA071]/60">Кінець:</span>{" "}
                  {new Date(stats.last_sync.finished_at).toLocaleString("uk-UA")}
                </p>
              )}
              {stats.last_sync.laws_processed != null && (
                <p>
                  <span className="font-medium text-[#BFA071]/60">Оброблено:</span>{" "}
                  {stats.last_sync.laws_processed} законів
                </p>
              )}
              {stats.last_sync.error_message && (
                <p className="text-red-400">{stats.last_sync.error_message}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="bg-[#0d1120]/40 border border-dashed border-[#BFA071]/10 rounded-[2rem] p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em]">Швидкі дії</p>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Перейдіть до потрібного розділу</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/settings">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#BFA071]/15 hover:border-[#BFA071]/30 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl text-xs">
                <Settings className="w-4 h-4" /> Налаштування
              </Button>
            </Link>
            <Link href="/admin/base">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#BFA071]/15 hover:border-[#BFA071]/30 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl text-xs">
                <BookOpen className="w-4 h-4" /> База знань
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#BFA071]/15 hover:border-[#BFA071]/30 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl text-xs">
                <FileText className="w-4 h-4" /> Відкрити чат
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
