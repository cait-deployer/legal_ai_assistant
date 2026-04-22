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

type DiskSourceStat = {
  files: number
  size_mb: number
  recent: { law_id: string; size_kb: number; title: string; mtime: string }[]
}

type DiskState = {
  sources: Record<string, DiskSourceStat>
  total_mb: number
}

type LawPreview = {
  law_id: string
  source: string
  meta: Record<string, string>
  text: string
  size_kb: number
  chars: number
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [collectionsReady, setCollectionsReady] = useState<boolean | null>(null)
  const [initDone, setInitDone] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/reindex/logs")
      if (res.ok) setState(await res.json())
    } catch { /* ignore */ }
  }, [])

  const checkCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/analytics?limit=1")
      if (res.ok) {
        const data = await res.json()
        const counts: Record<string, number> = data.qdrant_v2 ?? {}
        const allExist = Object.keys(counts).length >= 17 && Object.values(counts).every(v => v >= 0)
        setCollectionsReady(allExist)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchState()
    checkCollections()
  }, [fetchState, checkCollections])

  useEffect(() => {
    if (state?.running) {
      pollRef.current = setInterval(fetchState, 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state?.running, fetchState])

  async function handleInit() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/admin/v2/reindex/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ init_only: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || data.error || "Помилка")
      } else {
        await fetchState()
        pollRef.current = setInterval(async () => {
          await fetchState()
          await checkCollections()
        }, 3000)
        setInitDone(true)
      }
    } catch {
      setError("Помилка з'єднання")
    }
    setLoading(false)
  }

  async function handleStart() {
    setLoading(true)
    setError("")
    try {
      const body: Record<string, unknown> = { init_only: false }
      if (source) body.source = source
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
      {/* Guide */}
      <div className="bg-[#0d1120] rounded-2xl border border-[#C9A84C]/20 p-5 space-y-3">
        <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Як це працює — 2 кроки</h3>
        <div className="space-y-2 text-sm text-[#E0E6ED]/80">
          <div className="flex gap-3">
            <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${collectionsReady ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/30"}`}>1</span>
            <div>
              <span className="font-semibold">Ініціалізація колекцій</span>
              <span className="text-gray-400"> — створює 17 порожніх _v2 колекцій у Qdrant. </span>
              {collectionsReady === true && <span className="text-emerald-400 font-bold">✅ Вже зроблено!</span>}
              {collectionsReady === false && <span className="text-amber-400">Потрібно зробити один раз.</span>}
              {collectionsReady === null && <span className="text-gray-500">Перевірка...</span>}
            </div>
          </div>
          <div className="flex gap-3">
            <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${collectionsReady ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/30" : "bg-gray-700/50 text-gray-500 border border-gray-600/30"}`}>2</span>
            <div>
              <span className="font-semibold">Реіндекс</span>
              <span className="text-gray-400"> — читає тексти з диску ({`/root/laws_raw/`}), ділить на чанки, ембедить через gemini-embedding-001, завантажує у Qdrant. Займає ~50-80 годин для всіх джерел. </span>
              <span className="text-gray-500">Можна зупинити і продовжити в будь-який момент.</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-500 border-t border-[#C9A84C]/10 pt-3">
          ⚠️ Реіндекс запускати тільки після того, як скрапер завантажив файли на диск (вкладка Скрапер)
        </div>
      </div>

      {/* Step 1: Init */}
      {collectionsReady === false && !initDone && (
        <div className="bg-[#111827] rounded-2xl border border-amber-500/20 p-5 space-y-3">
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Крок 1 — Ініціалізація колекцій</h3>
          <p className="text-sm text-gray-400">Колекції ще не створені. Натисни кнопку нижче — займе 5-10 секунд.</p>
          <button
            onClick={handleInit}
            disabled={loading || (state?.running ?? false)}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Створення..." : "🗂️ Створити 17 колекцій Qdrant"}
          </button>
        </div>
      )}

      {collectionsReady === true && (
        <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/20 px-4 py-3 text-sm text-emerald-300 font-medium">
          ✅ 17 _v2 колекцій Qdrant існують. Крок 1 виконано.
        </div>
      )}

      {/* Step 2: Reindex controls */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Крок 2 — Реіндекс</h3>
          <RunningBadge running={state?.running ?? false} paused={state?.pause_requested ?? false} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 uppercase tracking-wider">Джерело</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            disabled={state?.running}
            className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] disabled:opacity-50 w-48"
          >
            <option value="">Усі джерела</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="text-xs text-gray-600 mt-1">
            Рекомендується: спочатку "Усі джерела". Або вибери конкретне якщо хочеш переіндексувати тільки одне.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {state?.can_resume && !state?.running && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-300 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold">Є збережений прогрес</span>
              <span className="text-amber-400/70"> — файл {state.resume_progress?.file_idx ?? "?"} з усіх. Натисни «Продовжити» щоб не починати заново.</span>
            </div>
            <button
              onClick={handleResume}
              disabled={loading}
              className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              ▶ Продовжити
            </button>
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {!state?.running && !state?.can_resume && (
            <button
              onClick={handleStart}
              disabled={loading || collectionsReady === false}
              className="px-5 py-2.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
            >
              ▶ Запустити реіндекс
            </button>
          )}
          {!state?.running && state?.can_resume && (
            <button
              onClick={handleStart}
              disabled={loading || collectionsReady === false}
              className="px-4 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors"
            >
              Почати заново
            </button>
          )}
          {state?.running && (
            <button
              onClick={handleStop}
              disabled={loading}
              className="px-5 py-2.5 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              ⏸ Зупинити (збереже прогрес)
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

      {/* Progress stats */}
      {statSources.length > 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-3">
          <h3 className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">
            Статистика {state?.resume_progress?.file_idx != null && `— позиція ${state.resume_progress.file_idx}`}
          </h3>
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

// ── Disk tab ───────────────────────────────────────────────────────────────────

type FileEntry = { law_id: string; source: string; title: string; size_kb: number; mtime: string }

function DiskTab() {
  const [disk, setDisk] = useState<DiskState | null>(null)
  const [diskLoading, setDiskLoading] = useState(false)

  // File browser state
  const [files, setFiles] = useState<FileEntry[]>([])
  const [total, setTotal] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [sortBy, setSortBy] = useState("mtime")
  const [order, setOrder] = useState("desc")
  const [offset, setOffset] = useState(0)
  const PAGE_SIZE = 50

  // Preview state
  const [preview, setPreview] = useState<LawPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")

  const fetchDisk = useCallback(async () => {
    setDiskLoading(true)
    try {
      const res = await fetch("/api/admin/v2/disk")
      if (res.ok) setDisk(await res.json())
    } catch { /* ignore */ }
    setDiskLoading(false)
  }, [])

  const fetchFiles = useCallback(async (off = 0, s = search, src = filterSource, sb = sortBy, ord = order) => {
    setFilesLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off), sort_by: sb, order: ord })
      if (s) params.set("search", s)
      if (src) params.set("source", src)
      const res = await fetch(`/api/admin/v2/disk/files?${params}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files ?? [])
        setTotal(data.total ?? 0)
      }
    } catch { /* ignore */ }
    setFilesLoading(false)
  }, [search, filterSource, sortBy, order])

  useEffect(() => {
    fetchDisk()
    fetchFiles(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch() {
    setOffset(0)
    fetchFiles(0, search, filterSource, sortBy, order)
  }

  async function handlePreview(source: string, law_id: string) {
    setPreviewLoading(true)
    setPreviewError("")
    setPreview(null)
    try {
      const res = await fetch(`/api/admin/v2/disk/law?source=${source}&law_id=${encodeURIComponent(law_id)}`)
      if (res.ok) {
        setPreview(await res.json())
        setTimeout(() => document.getElementById("law-preview")?.scrollIntoView({ behavior: "smooth" }), 100)
      } else {
        const err = await res.json()
        setPreviewError(err.detail || err.error || "Помилка")
      }
    } catch (e) {
      setPreviewError(String(e))
    }
    setPreviewLoading(false)
  }

  function handleSort(col: string) {
    const newOrder = sortBy === col && order === "desc" ? "asc" : "desc"
    setSortBy(col)
    setOrder(newOrder)
    setOffset(0)
    fetchFiles(0, search, filterSource, col, newOrder)
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <span className="text-gray-600 ml-1">↕</span>
    return <span className="text-[#C9A84C] ml-1">{order === "desc" ? "↓" : "↑"}</span>
  }

  return (
    <div className="space-y-6">
      {/* Disk summary */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
            /root/laws_raw/
            {disk && <span className="ml-3 text-gray-400 font-normal normal-case tracking-normal">{disk.total_mb} MB всього</span>}
          </h3>
          <button onClick={() => { fetchDisk(); fetchFiles(0) }} disabled={diskLoading}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors">
            {diskLoading ? "..." : "Оновити"}
          </button>
        </div>
        {disk && (
          <div className="grid grid-cols-5 gap-2">
            {SOURCES.map(src => {
              const s = disk.sources[src]
              return (
                <button
                  key={src}
                  onClick={() => { setFilterSource(src); setOffset(0); fetchFiles(0, search, src, sortBy, order) }}
                  className={`text-center rounded-xl border px-3 py-3 transition-colors hover:border-[#C9A84C]/40 cursor-pointer ${filterSource === src ? "border-[#C9A84C]/40 bg-[#C9A84C]/5" : "border-[#C9A84C]/10 bg-[#0A0E1A]"}`}
                >
                  <div className="text-lg font-black text-emerald-400">{s?.files?.toLocaleString() ?? 0}</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">{src}</div>
                  <div className="text-[10px] text-gray-600">{s?.size_mb ?? 0} MB</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* File browser */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
        <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
          Файли
          <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
            {total > 0 ? `${total.toLocaleString()} знайдено` : ""}
          </span>
        </h3>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end">
          <input
            type="text"
            placeholder="Пошук за ID або назвою..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            className="flex-1 min-w-[220px] bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] placeholder:text-gray-600"
          />
          <select
            value={filterSource}
            onChange={e => { setFilterSource(e.target.value); setOffset(0); fetchFiles(0, search, e.target.value, sortBy, order) }}
            className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]"
          >
            <option value="">Всі джерела</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={handleSearch}
            disabled={filesLoading}
            className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
          >
            {filesLoading ? "..." : "Знайти"}
          </button>
          {(search || filterSource) && (
            <button
              onClick={() => { setSearch(""); setFilterSource(""); setOffset(0); fetchFiles(0, "", "", sortBy, order) }}
              className="px-3 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-gray-400 text-sm hover:text-[#E0E6ED] transition-colors"
            >
              ✕ Скинути
            </button>
          )}
        </div>

        {/* Table */}
        {files.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none" onClick={() => handleSort("law_id")}>
                      ID <SortIcon col="law_id" />
                    </th>
                    <th className="pb-2 pr-3">Джерело</th>
                    <th className="pb-2 pr-3">Назва</th>
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none text-right" onClick={() => handleSort("size")}>
                      KB <SortIcon col="size" />
                    </th>
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none" onClick={() => handleSort("mtime")}>
                      Час <SortIcon col="mtime" />
                    </th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {files.map(f => (
                    <tr key={`${f.source}-${f.law_id}`} className="text-[#E0E6ED] hover:bg-[#C9A84C]/5 transition-colors">
                      <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-400">{f.law_id}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{f.source}</td>
                      <td className="py-1.5 pr-3 max-w-[280px] truncate text-gray-300">{f.title || "—"}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-500">{f.size_kb}</td>
                      <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">
                        {new Date(f.mtime).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-1.5">
                        <button
                          onClick={() => handlePreview(f.source, f.law_id)}
                          disabled={previewLoading}
                          className="px-2 py-0.5 rounded bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/20 hover:bg-[#C9A84C]/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          Читати
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} з {total.toLocaleString()}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchFiles(o) }}
                  disabled={offset === 0 || filesLoading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >← Назад</button>
                <span className="px-2 py-1 text-gray-600">стор. {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                <button
                  onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); fetchFiles(o) }}
                  disabled={offset + PAGE_SIZE >= total || filesLoading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >Вперед →</button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-600 py-6 text-center">
            {filesLoading ? "Завантаження..." : total === 0 && search ? "Нічого не знайдено" : "Натисніть «Знайти» для пошуку"}
          </div>
        )}
      </div>

      {/* Law preview */}
      {(preview || previewError) && (
        <div id="law-preview" className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Перегляд тексту</h3>
            <button onClick={() => { setPreview(null); setPreviewError("") }} className="text-gray-500 hover:text-gray-300 text-sm">✕ Закрити</button>
          </div>

          {previewError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{previewError}</div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span className="font-mono font-bold text-[#C9A84C]">{preview.law_id}</span>
                  <span>·</span><span>{preview.source}</span>
                  <span>·</span><span>{preview.size_kb} KB</span>
                  <span>·</span><span>{preview.chars.toLocaleString()} символів</span>
                  {preview.meta.effective_date && <><span>·</span><span>{preview.meta.effective_date}</span></>}
                  {preview.meta.category && <><span>·</span><span>{preview.meta.category}</span></>}
                  {preview.meta.law_url && (
                    <><span>·</span>
                    <a href={preview.meta.law_url} target="_blank" rel="noopener noreferrer" className="text-[#C9A84C] hover:underline">
                      Відкрити на сайті →
                    </a></>
                  )}
                </div>
                {preview.meta.title && (
                  <div className="text-sm font-semibold text-[#E0E6ED]">{preview.meta.title}</div>
                )}
              </div>
              <pre className="font-mono text-[11px] text-gray-300 whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto leading-relaxed bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-4">
                {preview.text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = "scraper" | "reindex" | "analytics" | "disk"

const TABS: { id: Tab; label: string }[] = [
  { id: "scraper",   label: "Скрапер" },
  { id: "reindex",   label: "Реіндекс" },
  { id: "analytics", label: "Аналітика" },
  { id: "disk",      label: "Диск" },
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
        {tab === "disk"      && <DiskTab />}
      </div>
    </div>
  )
}
