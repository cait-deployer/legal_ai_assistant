"use client"

import { useState, useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = {
  ts: string
  message: string
  level: string
}

type ScrapeStats = Record<string, {
  ok?: number
  empty?: number
  restricted?: number
  error?: number
  skipped?: number
}>

type ScrapeResumeProgress = {
  source_idx: number
  inner_idx: number
  stats: ScrapeStats
}

type ScrapePanelState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ScrapeResumeProgress | null
}

type ReindexStats = Record<string, {
  laws?: number
  chunks?: number
  uploaded?: number
  errors?: number
}>

type ReindexResumeProgress = {
  file_idx: number
  stats: ReindexStats
}

type ReindexPanelState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ReindexResumeProgress | null
}

type AnalyticsSummary = {
  total: number
  ok: number
  empty: number
  restricted: number
  error: number
}

type AnalyticsBySource = Record<string, { ok: number; empty: number; restricted: number; error: number }>

type AnalyticsLaw = {
  law_id: string
  source: string
  status: string
  title?: string
  reason?: string
  scraped_at?: string
}

type AnalyticsState = {
  summary: AnalyticsSummary
  by_source: AnalyticsBySource
  qdrant_v2: Record<string, number>
  laws: AnalyticsLaw[]
  total_filtered: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki"]

const RADA_COLLECTIONS = [
  "rada_finance", "rada_state", "rada_personnel", "rada_court",
  "rada_intl", "rada_labor", "rada_civil", "rada_criminal",
  "rada_admin", "rada_housing", "rada_land", "rada_industry", "rada_other",
]

const STATUS_COLORS: Record<string, string> = {
  ok:         "text-emerald-400",
  empty:      "text-amber-400",
  restricted: "text-blue-400",
  error:      "text-red-400",
  skipped:    "text-gray-400",
}

const STATUS_BADGE: Record<string, string> = {
  ok:         "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  empty:      "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  restricted: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  error:      "bg-red-500/20 text-red-300 border border-red-500/30",
  skipped:    "bg-gray-500/20 text-gray-300 border border-gray-500/30",
}

// ── Log panel ──────────────────────────────────────────────────────────────────

function levelColor(level: string): string {
  if (level === "error") return "text-red-400"
  if (level === "warning") return "text-amber-400"
  if (level === "success") return "text-emerald-400"
  return "text-gray-400"
}

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  return (
    <div className="font-mono text-[11px] h-[400px] overflow-y-auto bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 p-3 space-y-0.5">
      {logs.length === 0 && (
        <span className="text-gray-600">Очікування запуску...</span>
      )}
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gray-600 shrink-0">
            {new Date(l.ts).toLocaleTimeString("uk-UA")}
          </span>
          <span className={levelColor(l.level)}>{l.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

// ── Running badge ──────────────────────────────────────────────────────────────

function RunningBadge({ running, paused }: { running: boolean; paused: boolean }) {
  if (running && paused)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Зупиняється
      </span>
    )
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Виконується
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-gray-500/20 text-gray-400 border border-gray-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      Зупинено
    </span>
  )
}

// ── Scraper tab ────────────────────────────────────────────────────────────────

function ScraperTab() {
  const [state, setState] = useState<ScrapePanelState | null>(null)
  const [source, setSource] = useState<string>("")
  const [radaCollection, setRadaCollection] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/scrape/logs")
      if (res.ok) setState(await res.json())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  useEffect(() => {
    if (state?.running) {
      pollRef.current = setInterval(fetchState, 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state?.running, fetchState])

  async function handleStart() {
    setLoading(true)
    setError("")
    try {
      const body: Record<string, string> = {}
      if (source) body.source = source
      if (source === "rada" && radaCollection) body.rada_collection = radaCollection
      const res = await fetch("/api/admin/v2/scrape/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка запуску")
      else { await fetchState(); pollRef.current = setInterval(fetchState, 3000) }
    } catch {
      setError("Помилка з'єднання")
    }
    setLoading(false)
  }

  async function handleStop() {
    setLoading(true)
    try {
      await fetch("/api/admin/v2/scrape/stop", { method: "POST" })
      await fetchState()
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function handleResume() {
    setLoading(true)
    setError("")
    try {
      const body: Record<string, string> = {}
      if (source) body.source = source
      if (source === "rada" && radaCollection) body.rada_collection = radaCollection
      const res = await fetch("/api/admin/v2/scrape/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка відновлення")
      else { await fetchState(); pollRef.current = setInterval(fetchState, 3000) }
    } catch {
      setError("Помилка з'єднання")
    }
    setLoading(false)
  }

  const stats = state?.resume_progress?.stats ?? {}
  const statSources = Object.keys(stats)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#E0E6ED]">Скрапер v2</h2>
          <RunningBadge running={state?.running ?? false} paused={state?.pause_requested ?? false} />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Джерело</label>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              disabled={state?.running}
              className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] disabled:opacity-50"
            >
              <option value="">Усі джерела</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {source === "rada" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Блок Ради</label>
              <select
                value={radaCollection}
                onChange={e => setRadaCollection(e.target.value)}
                disabled={state?.running}
                className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] disabled:opacity-50"
              >
                <option value="">Усі блоки Ради</option>
                {RADA_COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {!state?.running && (
            <button
              onClick={handleStart}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
            >
              Запустити
            </button>
          )}
          {state?.running && !state.pause_requested && (
            <button
              onClick={handleStop}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Зупинити
            </button>
          )}
          {state?.can_resume && !state?.running && (
            <button
              onClick={handleResume}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 disabled:opacity-50 transition-colors"
            >
              Продовжити
            </button>
          )}
          <button
            onClick={fetchState}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors"
          >
            Оновити
          </button>
        </div>
      </div>

      {/* Resume progress */}
      {state?.resume_progress && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Прогрес</h3>
          <div className="flex gap-4 text-sm text-gray-400">
            <span>Джерело: <b className="text-[#E0E6ED]">{state.resume_progress.source_idx}</b></span>
            <span>Позиція: <b className="text-[#E0E6ED]">{state.resume_progress.inner_idx}</b></span>
          </div>
          {statSources.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-4">Джерело</th>
                    <th className="pb-2 pr-4 text-emerald-400">OK</th>
                    <th className="pb-2 pr-4 text-amber-400">Порожній</th>
                    <th className="pb-2 pr-4 text-blue-400">Обмежено</th>
                    <th className="pb-2 pr-4 text-red-400">Помилка</th>
                    <th className="pb-2 text-gray-400">Пропущено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {statSources.map(src => {
                    const s = stats[src] ?? {}
                    return (
                      <tr key={src} className="text-[#E0E6ED]">
                        <td className="py-1.5 pr-4 font-mono">{src}</td>
                        <td className="py-1.5 pr-4 text-emerald-400">{s.ok ?? 0}</td>
                        <td className="py-1.5 pr-4 text-amber-400">{s.empty ?? 0}</td>
                        <td className="py-1.5 pr-4 text-blue-400">{s.restricted ?? 0}</td>
                        <td className="py-1.5 pr-4 text-red-400">{s.error ?? 0}</td>
                        <td className="py-1.5 text-gray-400">{s.skipped ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Logs */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
        <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Логи</h3>
        <LogPanel logs={state?.live_logs ?? []} />
      </div>
    </div>
  )
}

// ── Reindex tab ────────────────────────────────────────────────────────────────

function ReindexTab() {
  const [state, setState] = useState<ReindexPanelState | null>(null)
  const [source, setSource] = useState<string>("")
  const [initOnly, setInitOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/reindex/logs")
      if (res.ok) setState(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  useEffect(() => {
    if (state?.running) {
      pollRef.current = setInterval(fetchState, 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state?.running, fetchState])

  async function trigger(overrides: Record<string, unknown> = {}) {
    setLoading(true)
    setError("")
    try {
      const body: Record<string, unknown> = { init_only: initOnly, ...overrides }
      if (source && !initOnly) body.source = source
      const res = await fetch("/api/admin/v2/reindex/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка запуску")
      else { await fetchState(); pollRef.current = setInterval(fetchState, 3000) }
    } catch {
      setError("Помилка з'єднання")
    }
    setLoading(false)
  }

  async function handleStop() {
    setLoading(true)
    try {
      await fetch("/api/admin/v2/reindex/stop", { method: "POST" })
      await fetchState()
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function handleResume() {
    setLoading(true)
    setError("")
    try {
      const body: Record<string, unknown> = { init_only: false }
      if (source) body.source = source
      const res = await fetch("/api/admin/v2/reindex/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка відновлення")
      else { await fetchState(); pollRef.current = setInterval(fetchState, 3000) }
    } catch {
      setError("Помилка з'єднання")
    }
    setLoading(false)
  }

  const stats = state?.resume_progress?.stats ?? {}
  const statSources = Object.keys(stats)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#E0E6ED]">Реіндекс v2</h2>
          <RunningBadge running={state?.running ?? false} paused={state?.pause_requested ?? false} />
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Джерело</label>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              disabled={state?.running || initOnly}
              className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] disabled:opacity-50"
            >
              <option value="">Усі джерела</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#E0E6ED] cursor-pointer pb-1">
            <input
              type="checkbox"
              checked={initOnly}
              onChange={e => setInitOnly(e.target.checked)}
              disabled={state?.running}
              className="w-4 h-4 rounded accent-[#C9A84C] disabled:opacity-50"
            />
            <span className={initOnly ? "text-[#C9A84C]" : ""}>
              Тільки ініціалізація колекцій (без завантаження)
            </span>
          </label>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {!state?.running && (
            <button
              onClick={() => trigger()}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
            >
              Запустити
            </button>
          )}
          {!state?.running && (
            <button
              onClick={() => trigger({ init_only: true, source: undefined })}
              disabled={loading || state?.running}
              className="px-4 py-2 rounded-lg bg-blue-700 text-white font-bold text-sm hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              Ініціалізувати колекції
            </button>
          )}
          {state?.running && !state.pause_requested && (
            <button
              onClick={handleStop}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Зупинити
            </button>
          )}
          {state?.can_resume && !state?.running && (
            <button
              onClick={handleResume}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-emerald-700 text-white font-bold text-sm hover:bg-emerald-800 disabled:opacity-50 transition-colors"
            >
              Продовжити
            </button>
          )}
          <button
            onClick={fetchState}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors"
          >
            Оновити
          </button>
        </div>
      </div>

      {/* Resume progress */}
      {state?.resume_progress && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Прогрес</h3>
          <div className="flex gap-4 text-sm text-gray-400">
            <span>Файл: <b className="text-[#E0E6ED]">{state.resume_progress.file_idx}</b></span>
          </div>
          {statSources.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-4">Джерело</th>
                    <th className="pb-2 pr-4">Законів</th>
                    <th className="pb-2 pr-4">Чанків</th>
                    <th className="pb-2 pr-4 text-emerald-400">Завантажено</th>
                    <th className="pb-2 text-red-400">Помилок</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {statSources.map(src => {
                    const s = stats[src] ?? {}
                    return (
                      <tr key={src} className="text-[#E0E6ED]">
                        <td className="py-1.5 pr-4 font-mono">{src}</td>
                        <td className="py-1.5 pr-4">{s.laws ?? 0}</td>
                        <td className="py-1.5 pr-4">{s.chunks ?? 0}</td>
                        <td className="py-1.5 pr-4 text-emerald-400">{s.uploaded ?? 0}</td>
                        <td className="py-1.5 text-red-400">{s.errors ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Logs */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
        <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Логи</h3>
        <LogPanel logs={state?.live_logs ?? []} />
      </div>
    </div>
  )
}

// ── Analytics tab ──────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [offset, setOffset] = useState(0)
  const PAGE_SIZE = 50

  const fetchData = useCallback(async (off = 0, st = filterStatus, src = filterSource) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) })
      if (st) params.set("status", st)
      if (src) params.set("source", src)
      const res = await fetch(`/api/admin/v2/analytics?${params}`)
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [filterStatus, filterSource])

  useEffect(() => {
    fetchData(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFilter() {
    setOffset(0)
    fetchData(0, filterStatus, filterSource)
  }

  function handlePrev() {
    const newOff = Math.max(0, offset - PAGE_SIZE)
    setOffset(newOff)
    fetchData(newOff, filterStatus, filterSource)
  }

  function handleNext() {
    const newOff = offset + PAGE_SIZE
    setOffset(newOff)
    fetchData(newOff, filterStatus, filterSource)
  }

  const summary = data?.summary
  const bySource = data?.by_source ?? {}
  const qdrantV2 = data?.qdrant_v2 ?? {}
  const laws = data?.laws ?? []
  const totalFiltered = data?.total_filtered ?? 0

  const summaryCards = [
    { label: "Всього", value: summary?.total ?? 0, color: "text-[#C9A84C]" },
    { label: "OK", value: summary?.ok ?? 0, color: "text-emerald-400" },
    { label: "Порожній", value: summary?.empty ?? 0, color: "text-amber-400" },
    { label: "Обмежено", value: summary?.restricted ?? 0, color: "text-blue-400" },
    { label: "Помилка", value: summary?.error ?? 0, color: "text-red-400" },
  ]

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 text-center">
            <div className={`text-3xl font-black ${card.color}`}>{card.value.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Per-source table */}
      {Object.keys(bySource).length > 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">По джерелах</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                  <th className="pb-2 pr-4">Джерело</th>
                  <th className="pb-2 pr-4 text-emerald-400">OK</th>
                  <th className="pb-2 pr-4 text-amber-400">Порожній</th>
                  <th className="pb-2 pr-4 text-blue-400">Обмежено</th>
                  <th className="pb-2 text-red-400">Помилка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9A84C]/5">
                {Object.entries(bySource).map(([src, counts]) => (
                  <tr key={src} className="text-[#E0E6ED]">
                    <td className="py-1.5 pr-4 font-mono">{src}</td>
                    <td className="py-1.5 pr-4 text-emerald-400">{counts.ok}</td>
                    <td className="py-1.5 pr-4 text-amber-400">{counts.empty}</td>
                    <td className="py-1.5 pr-4 text-blue-400">{counts.restricted}</td>
                    <td className="py-1.5 text-red-400">{counts.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Qdrant v2 collections */}
      {Object.keys(qdrantV2).length > 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Qdrant v2 колекції</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                  <th className="pb-2 pr-4">Колекція</th>
                  <th className="pb-2 text-right">Точок</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9A84C]/5">
                {Object.entries(qdrantV2).map(([col, count]) => (
                  <tr key={col} className="text-[#E0E6ED]">
                    <td className="py-1.5 pr-4 font-mono">{col}</td>
                    <td className="py-1.5 text-right">
                      {count === -1 ? (
                        <span className="inline-flex px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">—</span>
                      ) : (
                        <span className="text-emerald-400">{count.toLocaleString()}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter & laws table */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-4">
        <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Список законів</h3>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Статус</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]"
            >
              <option value="">Усі</option>
              <option value="ok">ok</option>
              <option value="empty">empty</option>
              <option value="restricted">restricted</option>
              <option value="error">error</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Джерело</label>
            <select
              value={filterSource}
              onChange={e => setFilterSource(e.target.value)}
              className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]"
            >
              <option value="">Усі</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button
            onClick={handleFilter}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
          >
            {loading ? "Завантаження..." : "Завантажити"}
          </button>
          <button
            onClick={() => fetchData(0, filterStatus, filterSource)}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors"
          >
            Оновити
          </button>
        </div>

        {laws.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">Джерело</th>
                    <th className="pb-2 pr-4">Статус</th>
                    <th className="pb-2 pr-4">Назва</th>
                    <th className="pb-2">Причина</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {laws.map(law => (
                    <tr key={law.law_id} className="text-[#E0E6ED] hover:bg-[#C9A84C]/5">
                      <td className="py-1.5 pr-4 font-mono text-[10px] text-gray-400 max-w-[120px] truncate">{law.law_id}</td>
                      <td className="py-1.5 pr-4">{law.source}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE[law.status] ?? STATUS_BADGE.error}`}>
                          {law.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 max-w-[200px] truncate text-gray-300">{law.title || "—"}</td>
                      <td className="py-1.5 max-w-[160px] truncate text-gray-500">{law.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, totalFiltered)} з {totalFiltered}</span>
              <div className="flex gap-2">
                <button
                  onClick={handlePrev}
                  disabled={offset === 0 || loading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >
                  ← Назад
                </button>
                <button
                  onClick={handleNext}
                  disabled={offset + PAGE_SIZE >= totalFiltered || loading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >
                  Вперед →
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-600 py-4 text-center">
            {loading ? "Завантаження..." : "Немає результатів. Натисніть «Завантажити» для пошуку."}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = "scraper" | "reindex" | "analytics"

const TABS: { id: Tab; label: string }[] = [
  { id: "scraper",   label: "Скрапер" },
  { id: "reindex",   label: "Реіндекс" },
  { id: "analytics", label: "Аналітика" },
]

export default function V2AdminPage() {
  const [tab, setTab] = useState<Tab>("scraper")

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-[#C9A84C] tracking-tight">V2 Панель</h1>
          <p className="text-sm text-gray-500 mt-1">
            gemini-embedding-001 · 3072 dims · 17 колекцій _v2
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-[#111827] rounded-xl border border-[#C9A84C]/10 p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                tab === t.id
                  ? "bg-[#C9A84C] text-[#0A0E1A]"
                  : "text-gray-400 hover:text-[#E0E6ED]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "scraper"   && <ScraperTab />}
        {tab === "reindex"   && <ReindexTab />}
        {tab === "analytics" && <AnalyticsTab />}
      </div>
    </div>
  )
}
