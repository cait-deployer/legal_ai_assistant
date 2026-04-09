"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, FileText, Clock,
  CheckCircle, XCircle, Loader2, RefreshCw,
  ArrowRight, Zap, Calendar, Settings, BookOpen, Pause,
  AlertTriangle, Info, TrendingUp, Timer,
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
  can_resume: boolean
  resume_progress?: { next_index: number; total: number } | null
}

type SyncRun = {
  status: "success" | "error" | "paused"
  laws_processed: number
  duration_sec: number | null
  started_at: string | null
  source?: string
}

type SyncStats = {
  reliability_30d: { total: number; success: number; error: number; paused: number; pct: number | null }
  laws_30d: number
  laws_7d: number
  avg_duration_sec: number | null
  consecutive_failures: number
  last_success_at: string | null
  last_failure_at: string | null
  last_14_runs: SyncRun[]
  alerts: { level: "error" | "warning" | "info"; message: string }[]
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec} с`
  return `${Math.floor(sec / 60)} хв ${sec % 60} с`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (m < 1) return "щойно"
  if (h < 1) return `${m} хв тому`
  if (d < 1) return `${h} год тому`
  if (d === 1) return "вчора"
  return `${d} дн. тому`
}

function Sparkline({ runs }: { runs: SyncRun[] }) {
  if (!runs.length) return null
  const maxLaws = Math.max(...runs.map(r => r.laws_processed), 1)
  return (
    <div className="flex items-end gap-0.5 h-10">
      {runs.map((r, i) => {
        const h = Math.max(4, Math.round((r.laws_processed / maxLaws) * 40))
        const color = r.status === "success" ? "bg-emerald-500" : r.status === "error" ? "bg-red-500" : "bg-blue-400"
        const label = `${r.started_at ? new Date(r.started_at).toLocaleDateString("uk-UA") : ""} · ${r.laws_processed} законів · ${r.status}`
        return (
          <div key={i} title={label} className="group relative flex-1 flex items-end cursor-default">
            <div className={`w-full rounded-sm opacity-70 group-hover:opacity-100 transition-opacity ${color}`} style={{ height: `${h}px` }} />
          </div>
        )
      })}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [scheduleToggling, setScheduleToggling] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchStats = async () => {
    setLoading(true)
    try {
      const [res, syncRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/sync/stats"),
      ])
      setStats(await res.json())
      if (syncRes.ok) setSyncStats(await syncRes.json())
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#C9A84C]/10">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-2xl shrink-0">
            <LayoutDashboard className="w-8 h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Огляд</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Загальний стан системи URAI</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-widest hidden sm:block">
              Оновлено {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Doc count */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Документів у базі</p>
            <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-[#C9A84C]" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : (
            <div className="text-4xl font-serif font-bold text-white tabular-nums">
              {stats?.doc_count?.toLocaleString() ?? "—"}
            </div>
          )}
          <p className="text-xs text-[#C9A84C]/50 mt-2 font-medium uppercase tracking-wider">Векторних чанків у Supabase</p>
        </div>

        {/* Schedule toggle */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Автосинхронізація</p>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${stats?.schedule_enabled ? "bg-emerald-400" : "bg-[#C9A84C]/20"}`} />
                  <span className="text-xl font-serif font-bold text-white">
                    {stats?.schedule_enabled ? "Увімкнено" : "Вимкнено"}
                  </span>
                </div>
                <p className="text-[10px] text-[#C9A84C]/50 mt-1.5 font-black uppercase tracking-wider">Щодня о 01:00</p>
              </div>
              <button
                onClick={handleToggleSchedule}
                disabled={scheduleToggling}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-60 ${stats?.schedule_enabled ? "bg-[#C9A84C]" : "bg-[#C9A84C]/20"
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
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Статус скрапінгу</p>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : stats?.scraping_running ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span className="text-xl font-serif font-bold text-amber-400">Виконується</span>
            </div>
          ) : stats?.can_resume ? (
            <div>
              <div className="flex items-center gap-2">
                <Pause className="w-4 h-4 text-blue-400" />
                <span className="text-xl font-serif font-bold text-blue-400">Призупинено</span>
              </div>
              {stats.resume_progress && (
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-[#E0E6ED]/50 mb-1">
                    <span>Прогрес</span>
                    <span>{stats.resume_progress.next_index} / {stats.resume_progress.total}</span>
                  </div>
                  <div className="w-full bg-[#0A0E1A] rounded-full h-1 overflow-hidden">
                    <div
                      className="bg-blue-400 h-full rounded-full"
                      style={{ width: `${Math.round((stats.resume_progress.next_index / stats.resume_progress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="text-xl font-serif font-bold text-white">Очікування</span>
            </div>
          )}
          <p className="text-[10px] text-[#C9A84C]/50 mt-2 font-black uppercase tracking-wider">Поточний стан синхронізації</p>
        </div>
      </div>

      {/* Sync health widget */}
      <div className={`bg-[#0d1120]/60 border rounded-[2rem] p-6 transition-all ${
        (syncStats?.consecutive_failures ?? 0) >= 3 ? "border-red-500/30"
        : (syncStats?.consecutive_failures ?? 0) === 1 ? "border-amber-500/20"
        : "border-[#C9A84C]/10"
      }`}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#C9A84C]" />
              <h2 className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Аналітика синхронізації</h2>
            </div>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Надійність та статистика за 30 днів</p>
          </div>
          <Link href="/admin/settings">
            <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 rounded-xl">
              Керувати <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-10 w-full rounded-xl bg-[#C9A84C]/5 animate-pulse" />
            <div className="grid grid-cols-4 gap-3">
              {[0,1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-[#C9A84C]/5 animate-pulse" />)}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Alerts */}
            {syncStats?.alerts.map((a, i) => (
              <div key={i} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm ${
                a.level === "error"   ? "bg-red-500/10 border-red-500/20 text-red-400"
                : a.level === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                : "bg-[#C9A84C]/5 border-[#C9A84C]/15 text-[#C9A84C]/80"
              }`}>
                {a.level === "error"   && <XCircle className="w-4 h-4 shrink-0" />}
                {a.level === "warning" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                {a.level === "info"    && <Info className="w-4 h-4 shrink-0" />}
                {a.message}
              </div>
            ))}

            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Reliability */}
              <div className="bg-[#0A0E1A]/60 rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Надійність
                </p>
                <p className={`text-2xl font-bold mt-1 ${
                  syncStats?.reliability_30d.pct == null ? "text-[#E0E6ED]/30"
                  : syncStats.reliability_30d.pct >= 80 ? "text-emerald-400"
                  : syncStats.reliability_30d.pct >= 50 ? "text-amber-400"
                  : "text-red-400"
                }`}>
                  {syncStats?.reliability_30d.pct != null ? `${syncStats.reliability_30d.pct}%` : "—"}
                </p>
                <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">
                  {syncStats ? `${syncStats.reliability_30d.success}/${syncStats.reliability_30d.total} запусків` : "—"}
                </p>
              </div>

              {/* Laws 30d */}
              <div className="bg-[#0A0E1A]/60 rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Законів / міс
                </p>
                <p className="text-2xl font-bold mt-1 text-white">
                  {syncStats?.laws_30d != null ? syncStats.laws_30d.toLocaleString("uk-UA") : "—"}
                </p>
                <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">
                  {syncStats?.laws_7d != null ? `${syncStats.laws_7d} за 7 днів` : ""}
                </p>
              </div>

              {/* Avg duration */}
              <div className="bg-[#0A0E1A]/60 rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                  <Timer className="w-3 h-3" /> Сер. тривалість
                </p>
                <p className="text-2xl font-bold mt-1 text-white">
                  {fmtDuration(syncStats?.avg_duration_sec ?? null)}
                </p>
                <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">успішних запусків</p>
              </div>

              {/* Last success */}
              <div className="bg-[#0A0E1A]/60 rounded-2xl px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Останній успіх
                </p>
                <p className={`text-xl font-bold mt-1 ${
                  !syncStats?.last_success_at ? "text-[#E0E6ED]/30"
                  : Date.now() - new Date(syncStats.last_success_at).getTime() > 7 * 86400000 ? "text-red-400"
                  : Date.now() - new Date(syncStats.last_success_at).getTime() > 3 * 86400000 ? "text-amber-400"
                  : "text-emerald-400"
                }`}>
                  {fmtRelative(syncStats?.last_success_at ?? null)}
                </p>
                <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">
                  {syncStats?.last_success_at ? new Date(syncStats.last_success_at).toLocaleDateString("uk-UA") : ""}
                </p>
              </div>
            </div>

            {/* Sparkline */}
            {syncStats && syncStats.last_14_runs.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/40 mb-2">
                  Останні {syncStats.last_14_runs.length} запусків
                  <span className="ml-2 font-normal normal-case text-[#E0E6ED]/30">(висота = кількість законів)</span>
                </p>
                <Sparkline runs={syncStats.last_14_runs} />
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[#E0E6ED]/40">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> успіх</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> помилка</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" /> призупинено</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="bg-[#0d1120]/40 border border-dashed border-[#C9A84C]/10 rounded-[2rem] p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Швидкі дії</p>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Перейдіть до потрібного розділу</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/settings">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <Settings className="w-4 h-4" /> Налаштування
              </Button>
            </Link>
            <Link href="/admin/base">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <BookOpen className="w-4 h-4" /> База знань
              </Button>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <FileText className="w-4 h-4" /> Відкрити чат
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
