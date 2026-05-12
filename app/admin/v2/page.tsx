"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { AlertCircle, Play, RefreshCw, Square } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = {
  ts: string
  message: string
  level: string
}

type ScrapeSourceStats = {
  ok?: number
  empty?: number
  restricted?: number
  error?: number
  skipped?: number
}

type ScrapeResumeProgress = {
  inner_idx: number
  stats: ScrapeSourceStats
}

type SourceState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ScrapeResumeProgress | null
}

type AllSourcesStatus = Record<string, SourceState>

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
  meta: Record<string, unknown>
  text: string
  size_kb: number
  chars: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]

const RADA_COLLECTIONS = [
  "rada_finance", "rada_state", "rada_personnel", "rada_court",
  "rada_intl", "rada_labor", "rada_civil", "rada_criminal",
  "rada_admin", "rada_housing", "rada_land", "rada_industry", "rada_other",
]

const STATUS_BADGE: Record<string, string> = {
  ok: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  empty: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  restricted: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  error: "bg-red-500/20 text-red-300 border border-red-500/30",
  skipped: "bg-gray-500/20 text-gray-300 border border-gray-500/30",
}

// ── Log panel ──────────────────────────────────────────────────────────────────

function levelColor(level: string): string {
  if (level === "error") return "text-red-400"
  if (level === "warning") return "text-amber-300 font-semibold"
  if (level === "success") return "text-emerald-400"
  return "text-gray-400"
}

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    userScrolledUp.current = el.scrollHeight - el.scrollTop - el.clientHeight > 40
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el || userScrolledUp.current) return
    el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="font-mono text-[11px] h-[400px] overflow-y-auto bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 p-3 space-y-0.5"
    >
      {logs.length === 0 && (
        <span className="text-gray-400">Очікування запуску...</span>
      )}
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gray-400 shrink-0">
            {new Date(l.ts).toLocaleTimeString("uk-UA")}
          </span>
          <span className={levelColor(l.level)}>{l.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── Running badge ──────────────────────────────────────────────────────────────

function RunningBadge({ running, paused }: { running: boolean; paused: boolean }) {
  if (running && paused)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Зупиняється
      </span>
    )
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Виконується
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-gray-500/20 text-gray-400 border border-gray-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      Зупинено
    </span>
  )
}

// ── Source labels ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  rada: "Верховна Рада (~15 500 законів)",
  kmu: "Кабінет Міністрів",
  ccu: "Конституційний суд",
  supreme: "Верховний суд",
  wiki: "Legal Aid Wiki (юридичні терміни)",
  positions: "Правові позиції ВС (~12 800 позицій)",
  mod: "Міністерство оборони (~210 документів)",
  zir: "ЗІР ДПС (~5 900 питань-відповідей)",
}

const DEFAULT_SOURCE_STATE: SourceState = {
  running: false, pause_requested: false, live_logs: [], can_resume: false, resume_progress: null,
}

// ── SourcePanel ─────────────────────────────────────────────────────────────────

function SourcePanel({ source, state, onRefresh }: {
  source: string
  state: SourceState
  onRefresh: () => Promise<void>
}) {
  const [logsOpen, setLogsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [radaCol, setRadaCol] = useState("")

  const stats = state.resume_progress?.stats ?? {}
  const idx = state.resume_progress?.inner_idx ?? 0

  async function doAction(endpoint: string, body: Record<string, string>) {
    setLoading(true); setError("")
    try {
      const res = await fetch(`/api/admin/v2/scrape/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, ...body }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка")
      else await onRefresh()
    } catch { setError("Помилка з'єднання") }
    setLoading(false)
  }

  const radaBody: Record<string, string> = source === "rada" && radaCol ? { rada_collection: radaCol } : {}

  return (
    <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-bold text-[#E0E6ED] uppercase tracking-wider">{source}</span>
          <span className="ml-2 text-xs text-gray-400 hidden sm:inline">{SOURCE_LABELS[source]}</span>
        </div>
        <RunningBadge running={state.running} paused={state.pause_requested} />
      </div>

      {/* Progress stats */}
      {state.resume_progress && (
        <div className="space-y-1">
          <div className="grid grid-cols-5 gap-1 text-center">
            {(["ok", "empty", "restricted", "error", "skipped"] as const).map(k => {
              const colors: Record<string, string> = {
                ok: "text-emerald-400 bg-emerald-500/10",
                empty: "text-amber-400 bg-amber-500/10",
                restricted: "text-blue-400 bg-blue-500/10",
                error: "text-red-400 bg-red-500/10",
                skipped: "text-gray-400 bg-gray-500/10",
              }
              const labels: Record<string, string> = {
                ok: "OK", empty: "Порожні", restricted: "Обмежено", error: "Помилки", skipped: "Пропущено"
              }
              return (
                <div key={k} className={`rounded-lg py-1.5 px-1 ${colors[k]}`}>
                  <div className="text-sm font-bold">{stats[k] ?? 0}</div>
                  <div className="text-[12px] opacity-70">{labels[k]}</div>
                </div>
              )
            })}
          </div>
          <div className="text-xs text-gray-400">Позиція: <b className="text-gray-300">{idx}</b></div>
        </div>
      )}

      {/* Rada collection filter */}
      {source === "rada" && !state.running && (
        <select value={radaCol} onChange={e => setRadaCol(e.target.value)}
          className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-xs text-[#E0E6ED] w-full max-w-xs">
          <option value="">Усі блоки Ради</option>
          {RADA_COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 flex-wrap">
        {!state.running && (
          <button onClick={() => doAction("trigger", radaBody)} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-xs hover:bg-[#d4b460] disabled:opacity-50 transition-colors">
            Запустити
          </button>
        )}
        {state.running && !state.pause_requested && (
          <button onClick={() => doAction("stop", {})} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-700 disabled:opacity-50 transition-colors">
            Зупинити
          </button>
        )}
        {state.can_resume && !state.running && (
          <button onClick={() => doAction("resume", radaBody)} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50 transition-colors">
            Продовжити
          </button>
        )}
        {state.live_logs.length > 0 && (
          <button onClick={() => setLogsOpen(o => !o)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
            {logsOpen ? "▲ Сховати логи" : "▼ Логи"}
          </button>
        )}
      </div>

      {/* Logs (collapsible) */}
      {logsOpen && state.live_logs.length > 0 && (
        <LogPanel logs={state.live_logs} />
      )}
    </div>
  )
}

// ── Scraper tab ────────────────────────────────────────────────────────────────

function ScraperTab() {
  const [allStatus, setAllStatus] = useState<AllSourcesStatus>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/scrape/status")
      if (res.ok) setAllStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void fetchStatus() }, 0)
    return () => window.clearTimeout(id)
  }, [fetchStatus])

  const anyRunning = SOURCES.some(s => allStatus[s]?.running)

  useEffect(() => {
    if (anyRunning) {
      pollRef.current = setInterval(fetchStatus, 3000)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [anyRunning, fetchStatus])

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[#E0E6ED]">Скрапер v2 — паралельний запуск</h2>
        <button onClick={fetchStatus}
          className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
          Оновити
        </button>
      </div>
      {SOURCES.map(src => (
        <SourcePanel
          key={src}
          source={src}
          state={allStatus[src] ?? DEFAULT_SOURCE_STATE}
          onRefresh={fetchStatus}
        />
      ))}
    </div>
  )
}

// ── Reindex types ──────────────────────────────────────────────────────────────

type ReindexSourceState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ReindexResumeProgress | null
}

type AllReindexStatus = Record<string, ReindexSourceState>

const DEFAULT_REINDEX_SOURCE_STATE: ReindexSourceState = {
  running: false, pause_requested: false, live_logs: [], can_resume: false, resume_progress: null,
}

// ── ReindexSourcePanel ─────────────────────────────────────────────────────────

function ReindexSourcePanel({ source, state, collectionsReady, onRefresh }: {
  source: string
  state: ReindexSourceState
  collectionsReady: boolean | null
  onRefresh: () => Promise<void>
}) {
  const [logsOpen, setLogsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [stoppedAt, setStoppedAt] = useState<string | null>(null)
  const prevRunning = useRef(state.running)

  // Detect running → stopped transition for banner
  useEffect(() => {
    let id: number | null = null
    if (prevRunning.current && !state.running) {
      id = window.setTimeout(() => {
        setStoppedAt(new Date().toLocaleTimeString("uk-UA"))
      }, 0)
    }
    prevRunning.current = state.running
    return () => {
      if (id) window.clearTimeout(id)
    }
  }, [state.running])

  async function doTrigger(reset = false) {
    setLoading(true); setError(""); setStoppedAt(null)
    try {
      const res = await fetch("/api/admin/v2/reindex/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, reset }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка запуску")
      else { setLogsOpen(true); await onRefresh() }
    } catch { setError("Помилка з'єднання") }
    setLoading(false)
  }

  async function doStop() {
    setLoading(true)
    try {
      await fetch("/api/admin/v2/reindex/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      await onRefresh()
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function doResume() {
    setLoading(true); setError(""); setStoppedAt(null)
    try {
      const res = await fetch("/api/admin/v2/reindex/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.detail || data.error || "Помилка відновлення")
      else { setLogsOpen(true); await onRefresh() }
    } catch { setError("Помилка з'єднання") }
    setLoading(false)
  }

  const stats = state.resume_progress?.stats ?? {}
  const fileIdx = state.resume_progress?.file_idx

  return (
    <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-bold text-[#E0E6ED] uppercase tracking-wider">{source}</span>
          <span className="ml-2 text-xs text-gray-400 hidden sm:inline">{SOURCE_LABELS[source]}</span>
        </div>
        <RunningBadge running={state.running} paused={state.pause_requested} />
      </div>

      {/* Progress stats */}
      {Object.keys(stats).length > 0 && (
        <div className="space-y-1">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-400 uppercase tracking-wider border-b border-[#C9A84C]/10">
                  <th className="pb-1 pr-3">Законів</th>
                  <th className="pb-1 pr-3">Чанків</th>
                  <th className="pb-1 pr-3 text-emerald-400">Завантажено</th>
                  <th className="pb-1 text-red-400">Помилок</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats).map(([src, s]) => (
                  <tr key={src} className="text-[#E0E6ED]">
                    <td className="py-1 pr-3">{s.laws ?? 0}</td>
                    <td className="py-1 pr-3">{s.chunks ?? 0}</td>
                    <td className="py-1 pr-3 text-emerald-400 font-semibold">{s.uploaded ?? 0}</td>
                    <td className="py-1 text-red-400">{s.errors ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fileIdx != null && (
            <div className="text-xs text-gray-400">Позиція: <b className="text-gray-300">{fileIdx}</b></div>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Stopped banner */}
      {stoppedAt && !state.running && (
        <div className="flex items-center justify-between gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            <span className="font-bold text-red-300">ЗУПИНЕНО о {stoppedAt}</span>
            {state.can_resume && <span className="text-amber-400">— прогрес збережено</span>}
          </div>
          <button onClick={() => setStoppedAt(null)} className="text-gray-400 hover:text-gray-400 text-xs">✕</button>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 flex-wrap">
        {!state.running && !state.can_resume && (
          <button
            onClick={() => doTrigger(false)}
            disabled={loading || collectionsReady === false}
            className="px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-xs hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
          >
            ▶ Запустити
          </button>
        )}
        {!state.running && state.can_resume && (
          <>
            <button
              onClick={doResume}
              disabled={loading || collectionsReady === false}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50 transition-colors"
            >
              ▶ Продовжити
            </button>
            <button
              onClick={() => doTrigger(true)}
              disabled={loading || collectionsReady === false}
              className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] disabled:opacity-50 transition-colors"
            >
              Почати заново
            </button>
          </>
        )}
        {state.running && !state.pause_requested && (
          <button
            onClick={doStop}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            ⏸ Зупинити
          </button>
        )}
        {state.live_logs.length > 0 && (
          <button
            onClick={() => setLogsOpen(o => !o)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors"
          >
            {logsOpen ? "▲ Сховати логи" : "▼ Логи"}
          </button>
        )}
      </div>

      {/* Logs (collapsible) */}
      {logsOpen && state.live_logs.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            {state.running && state.pause_requested && (
              <span className="text-xs text-amber-400 animate-pulse">Зупиняється, чекаємо завершення батчу...</span>
            )}
            {state.running && !state.pause_requested && (
              <span className="text-xs text-emerald-400 animate-pulse">Виконується...</span>
            )}
          </div>
          <LogPanel logs={state.live_logs} />
        </>
      )}
    </div>
  )
}

// ── Reindex tab ────────────────────────────────────────────────────────────────

function ReindexTab() {
  const [allStatus, setAllStatus] = useState<AllReindexStatus>({})
  const [collectionsReady, setCollectionsReady] = useState<boolean | null>(null)
  const [initLoading, setInitLoading] = useState(false)
  const [initError, setInitError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/reindex/status")
      if (res.ok) setAllStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  const checkCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/analytics?limit=1")
      if (res.ok) {
        const data = await res.json()
        const counts: Record<string, number> = data.qdrant_v2 ?? {}
        setCollectionsReady(Object.keys(counts).length >= 20 && Object.values(counts).every(v => v >= 0))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void fetchStatus()
      void checkCollections()
    }, 0)
    return () => window.clearTimeout(id)
  }, [fetchStatus, checkCollections])

  const anyRunning = SOURCES.some(s => allStatus[s]?.running)
  const anyStopping = SOURCES.some(s => allStatus[s]?.running && allStatus[s]?.pause_requested)

  // Adaptive polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (anyStopping) {
      pollRef.current = setInterval(fetchStatus, 1500)
    } else if (anyRunning) {
      pollRef.current = setInterval(fetchStatus, 3000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [anyRunning, anyStopping, fetchStatus])

  async function handleInit() {
    setInitLoading(true); setInitError("")
    try {
      const res = await fetch("/api/admin/v2/reindex/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ init_only: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInitError(data.detail || data.error || "Помилка")
      } else {
        await fetchStatus()
        await checkCollections()
      }
    } catch { setInitError("Помилка з'єднання") }
    setInitLoading(false)
  }

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
              <span className="text-gray-400"> — створює 20 _v2 колекцій у Qdrant. </span>
              {collectionsReady === true && <span className="text-emerald-400 font-bold">✅ Вже зроблено!</span>}
              {collectionsReady === false && <span className="text-amber-400">Потрібно зробити один раз.</span>}
              {collectionsReady === null && <span className="text-gray-400">Перевірка...</span>}
            </div>
          </div>
          <div className="flex gap-3">
            <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${collectionsReady ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/30" : "bg-gray-700/50 text-gray-400 border border-gray-600/30"}`}>2</span>
            <div>
              <span className="font-semibold">Реіндекс по джерелах</span>
              <span className="text-gray-400"> — обирай кожне джерело окремо. Читає тексти з диску, ділить на чанки, ембедить через gemini-embedding-001, завантажує у Qdrant. </span>
              <span className="text-amber-400 font-medium">Тільки одне джерело може працювати одночасно.</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-400 border-t border-[#C9A84C]/10 pt-3">
          ⚠️ Запускай реіндекс тільки після завершення скрапінгу (вкладка Скрапер)
        </div>
      </div>

      {/* Step 1: Init */}
      {collectionsReady === false && (
        <div className="bg-[#111827] rounded-2xl border border-amber-500/20 p-5 space-y-3">
          <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Крок 1 — Ініціалізація колекцій</h3>
          <p className="text-sm text-gray-400">Колекції ще не створені. Натисни кнопку — займе 5-10 секунд.</p>
          {initError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{initError}</div>
          )}
          <button
            onClick={handleInit}
            disabled={initLoading || anyRunning}
            className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {initLoading ? "Створення..." : "🗂️ Створити 17 колекцій Qdrant"}
          </button>
        </div>
      )}

      {collectionsReady === true && (
        <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/20 px-4 py-3 text-sm text-emerald-300 font-medium flex items-center justify-between">
          <span>✅ 17 _v2 колекцій Qdrant існують. Крок 1 виконано.</span>
          <button onClick={fetchStatus} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Оновити</button>
        </div>
      )}

      {/* Step 2: Per-source panels */}
      {collectionsReady !== false && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#E0E6ED]">Крок 2 — Реіндекс по джерелах</h3>
            <button onClick={fetchStatus} className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
              Оновити
            </button>
          </div>
          {SOURCES.map(src => (
            <ReindexSourcePanel
              key={src}
              source={src}
              state={allStatus[src] ?? DEFAULT_REINDEX_SOURCE_STATE}
              collectionsReady={collectionsReady}
              onRefresh={fetchStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Analytics tab ──────────────────────────────────────────────────────────────

const STATUS_FILTER_MAP: Record<string, string> = {
  "Всього": "", "OK": "ok", "Порожній": "empty", "Обмежено": "restricted", "Помилка": "error",
}

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [offset, setOffset] = useState(0)
  const [qdrantOpen, setQdrantOpen] = useState(false)
  const [colStats, setColStats] = useState<{ total: number; collections: Record<string, number> } | null>(null)
  const [colOpen, setColOpen] = useState(true)
  const lawsRef = useRef<HTMLDivElement>(null)
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
    fetch("/api/admin/v2/disk/by-collection")
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setColStats(d))
      .catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCardClick(label: string) {
    const st = STATUS_FILTER_MAP[label] ?? ""
    setFilterStatus(st)
    setOffset(0)
    fetchData(0, st, filterSource)
    setTimeout(() => lawsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150)
  }

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
    { label: "Всього", value: summary?.total ?? 0, color: "text-[#C9A84C]", ring: "ring-[#C9A84C]/50", filterVal: "" },
    { label: "OK", value: summary?.ok ?? 0, color: "text-emerald-400", ring: "ring-emerald-400/50", filterVal: "ok" },
    { label: "Порожній", value: summary?.empty ?? 0, color: "text-amber-400", ring: "ring-amber-400/50", filterVal: "empty" },
    { label: "Обмежено", value: summary?.restricted ?? 0, color: "text-blue-400", ring: "ring-blue-400/50", filterVal: "restricted" },
    { label: "Помилка", value: summary?.error ?? 0, color: "text-red-400", ring: "ring-red-400/50", filterVal: "error" },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Summary cards — clickable */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
        {summaryCards.map(card => {
          const active = filterStatus === card.filterVal
          return (
            <button
              key={card.label}
              onClick={() => handleCardClick(card.label)}
              className={`bg-[#111827] rounded-2xl border p-3 sm:p-4 text-center transition-all hover:scale-[1.03] active:scale-[0.98] cursor-pointer ${active ? `border-[#C9A84C]/40 ring-2 ${card.ring}` : "border-[#C9A84C]/10 hover:border-[#C9A84C]/30"
                }`}
            >
              <div className={`text-2xl sm:text-3xl font-black ${card.color}`}>{card.value.toLocaleString()}</div>
              <div className="text-[12px] sm:text-xs text-gray-400 mt-1 uppercase tracking-wider">{card.label}</div>
              {active && <div className="text-[9px] text-[#C9A84C] mt-1 font-bold">↓ фільтр</div>}
            </button>
          )
        })}
      </div>

      {/* Per-source table */}
      {Object.keys(bySource).length > 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-6 space-y-3">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">По джерелах</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-400 uppercase tracking-wider border-b border-[#C9A84C]/10">
                  <th className="pb-2 pr-3">Джерело</th>
                  <th className="pb-2 pr-3 text-emerald-400">OK</th>
                  <th className="pb-2 pr-3 text-amber-400 hidden sm:table-cell">Порожній</th>
                  <th className="pb-2 pr-3 text-blue-400 hidden sm:table-cell">Обмежено</th>
                  <th className="pb-2 text-red-400">Помилка</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#C9A84C]/5">
                {Object.entries(bySource).map(([src, counts]) => (
                  <tr key={src} className="text-[#E0E6ED]">
                    <td className="py-1.5 pr-3 font-mono">{src}</td>
                    <td className="py-1.5 pr-3 text-emerald-400">{counts.ok}</td>
                    <td className="py-1.5 pr-3 text-amber-400 hidden sm:table-cell">{counts.empty}</td>
                    <td className="py-1.5 pr-3 text-blue-400 hidden sm:table-cell">{counts.restricted}</td>
                    <td className="py-1.5 text-red-400">{counts.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Qdrant v2 collections — collapsible */}
      {Object.keys(qdrantV2).length > 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 overflow-hidden">
          <button
            onClick={() => setQdrantOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-[#C9A84C]/5 transition-colors"
          >
            <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Qdrant v2 колекції</h3>
            <span className="text-gray-400 text-lg leading-none">{qdrantOpen ? "▲" : "▼"}</span>
          </button>
          {qdrantOpen && (
            <div className="px-4 sm:px-6 pb-4 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-gray-400 uppercase tracking-wider border-b border-[#C9A84C]/10">
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
          )}
        </div>
      )}

      {/* Rada disk breakdown by collection */}
      {colStats && (
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 overflow-hidden">
          <button
            onClick={() => setColOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-[#C9A84C]/5 transition-colors"
          >
            <div>
              <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider text-left">Рада — файли по колекціях</h3>
              <p className="text-xs text-gray-400 mt-0.5 text-left">Всього на диску: {colStats.total.toLocaleString()} файлів</p>
            </div>
            <span className="text-gray-400 text-lg leading-none">{colOpen ? "▲" : "▼"}</span>
          </button>
          {colOpen && (
            <div className="px-4 sm:px-6 pb-4 space-y-2">
              {Object.entries(colStats.collections).map(([col, count]) => {
                const max = Math.max(...Object.values(colStats.collections))
                const pct = max > 0 ? Math.round((count / max) * 100) : 0
                const isEmpty = count === 0
                const shortName = col.replace("_v2", "").replace("laws_", "").replace("rada_", "")
                return (
                  <div key={col} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-mono ${isEmpty ? "text-red-400" : "text-[#E0E6ED]"}`}>{shortName}</span>
                      <span className={`font-bold tabular-nums ${isEmpty ? "text-red-400" : "text-[#C9A84C]"}`}>
                        {isEmpty ? "ПОРОЖНЬО" : count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#C9A84C]/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isEmpty ? "bg-red-500/50" : "bg-[#C9A84C]"}`}
                        style={{ width: `${Math.max(pct, isEmpty ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Filter & laws table */}
      <div ref={lawsRef} className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-6 space-y-4 scroll-mt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
            Список законів
            {filterStatus && (
              <span className={`ml-2 text-xs font-normal normal-case tracking-normal ${STATUS_BADGE[filterStatus]?.split(" ")[1] ?? "text-gray-400"}`}>
                · {filterStatus}
              </span>
            )}
          </h3>
          {filterStatus && (
            <button
              onClick={() => { setFilterStatus(""); setOffset(0); fetchData(0, "", filterSource) }}
              className="text-xs text-gray-400 hover:text-gray-300 underline transition-colors"
            >
              скинути фільтр
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 uppercase tracking-wider">Статус</label>
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
            <label className="text-xs text-gray-400 uppercase tracking-wider">Джерело</label>
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
                  <tr className="text-gray-400 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-3">ID</th>
                    <th className="pb-2 pr-3 hidden sm:table-cell">Джерело</th>
                    <th className="pb-2 pr-3">Статус</th>
                    <th className="pb-2 pr-3">Назва</th>
                    <th className="pb-2 hidden sm:table-cell">Причина</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {laws.map(law => (
                    <tr key={law.law_id} className="text-[#E0E6ED] hover:bg-[#C9A84C]/5">
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-gray-400 max-w-[100px] sm:max-w-[140px] truncate">{law.law_id}</td>
                      <td className="py-1.5 pr-3 hidden sm:table-cell">{law.source}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[12px] font-bold ${STATUS_BADGE[law.status] ?? STATUS_BADGE.error}`}>
                          {law.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 max-w-[140px] sm:max-w-[260px] truncate text-gray-300">{law.title || "—"}</td>
                      <td className="py-1.5 max-w-[140px] truncate text-gray-400 hidden sm:table-cell">{law.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
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
          <div className="text-sm text-gray-400 py-4 text-center">
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
    if (sortBy !== col) return <span className="text-gray-400 ml-1">↕</span>
    return <span className="text-[#C9A84C] ml-1">{order === "desc" ? "↓" : "↑"}</span>
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Disk summary */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
            /root/laws_raw/
            {disk && <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">{disk.total_mb} MB</span>}
          </h3>
          <button onClick={() => { fetchDisk(); fetchFiles(0) }} disabled={diskLoading}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors">
            {diskLoading ? "..." : "Оновити"}
          </button>
        </div>
        {disk && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {SOURCES.map(src => {
              const s = disk.sources[src]
              return (
                <button
                  key={src}
                  onClick={() => { setFilterSource(src === filterSource ? "" : src); setOffset(0); fetchFiles(0, search, src === filterSource ? "" : src, sortBy, order) }}
                  className={`text-center rounded-xl border px-2 py-3 transition-colors hover:border-[#C9A84C]/40 cursor-pointer ${filterSource === src ? "border-[#C9A84C]/40 bg-[#C9A84C]/5 ring-1 ring-[#C9A84C]/30" : "border-[#C9A84C]/10 bg-[#0A0E1A]"}`}
                >
                  <div className="text-base sm:text-lg font-black text-emerald-400">{s?.files?.toLocaleString() ?? 0}</div>
                  <div className="text-[12px] text-gray-400 font-mono mt-0.5">{src}</div>
                  <div className="text-[12px] text-gray-400">{s?.size_mb ?? 0} MB</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* File browser */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5 space-y-4">
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
            className="flex-1 min-w-[220px] bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] placeholder:text-gray-400"
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
                  <tr className="text-gray-400 uppercase tracking-wider border-b border-[#C9A84C]/10">
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none" onClick={() => handleSort("law_id")}>
                      ID <SortIcon col="law_id" />
                    </th>
                    <th className="pb-2 pr-3 hidden sm:table-cell">Дж.</th>
                    <th className="pb-2 pr-3">Назва</th>
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none text-right hidden sm:table-cell" onClick={() => handleSort("size")}>
                      KB <SortIcon col="size" />
                    </th>
                    <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none hidden sm:table-cell" onClick={() => handleSort("mtime")}>
                      Час <SortIcon col="mtime" />
                    </th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A84C]/5">
                  {files.map(f => (
                    <tr key={`${f.source}-${f.law_id}`} className="text-[#E0E6ED] hover:bg-[#C9A84C]/5 transition-colors">
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-gray-400 max-w-[90px] truncate">{f.law_id}</td>
                      <td className="py-1.5 pr-3 text-gray-400 hidden sm:table-cell">{f.source}</td>
                      <td className="py-1.5 pr-3 max-w-[140px] sm:max-w-[280px] truncate text-gray-300">{f.title || "—"}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-400 hidden sm:table-cell">{f.size_kb}</td>
                      <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap hidden sm:table-cell">
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
            <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} з {total.toLocaleString()}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchFiles(o) }}
                  disabled={offset === 0 || filesLoading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >← Назад</button>
                <span className="px-2 py-1 text-gray-400">стор. {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                <button
                  onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); fetchFiles(o) }}
                  disabled={offset + PAGE_SIZE >= total || filesLoading}
                  className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                >Вперед →</button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-400 py-6 text-center">
            {filesLoading ? "Завантаження..." : total === 0 && search ? "Нічого не знайдено" : "Натисніть «Знайти» для пошуку"}
          </div>
        )}
      </div>

      {/* Law preview */}
      {(preview || previewError) && (
        <div id="law-preview" className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Перегляд тексту</h3>
            <button onClick={() => { setPreview(null); setPreviewError("") }} className="text-gray-400 hover:text-gray-300 text-sm">✕ Закрити</button>
          </div>

          {previewError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{previewError}</div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-4 space-y-3">
                {/* Title row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                  <span className="font-mono font-bold text-[#C9A84C]">{preview.law_id}</span>
                  <span>·</span><span>{preview.source}</span>
                  <span>·</span><span>{preview.size_kb} KB</span>
                  <span>·</span><span>{preview.chars.toLocaleString()} символів</span>
                  {!!preview.meta.law_url && (
                    <><span>·</span>
                      <a href={String(preview.meta.law_url)} target="_blank" rel="noopener noreferrer" className="text-[#C9A84C] hover:underline">
                        Відкрити на сайті →
                      </a></>
                  )}
                </div>
                {!!preview.meta.title && (
                  <div className="text-sm font-semibold text-[#E0E6ED]">{String(preview.meta.title)}</div>
                )}
                {/* Metadata grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  {(([
                    ["Статус", preview.meta.status],
                    ["Тип документа", preview.meta.doc_type],
                    ["Номер", preview.meta.doc_number],
                    ["Автор", preview.meta.author],
                    ["Дата прийняття", preview.meta.date_adopted],
                    ["Набр. чинності", preview.meta.effective_date],
                    ["Категорія", preview.meta.category],
                    ["Scraped at", preview.meta.scraped_at],
                  ] as [string, unknown][]).map(([label, val]) => !!val ? (
                    <div key={label} className="flex gap-1">
                      <span className="text-gray-400 shrink-0">{label}:</span>
                      <span className={`truncate ${label === "Статус" && String(val).includes("Чинний") ? "text-emerald-400" : label === "Статус" ? "text-amber-400" : "text-gray-300"}`}>
                        {String(val)}
                      </span>
                    </div>
                  ) : null))}
                </div>
                {/* Boolean flags */}
                <div className="flex flex-wrap gap-1.5">
                  {!!preview.meta.is_retroactive && <span className="px-2 py-0.5 rounded text-[12px] bg-purple-500/20 text-purple-300 border border-purple-500/30">Зворотна дія</span>}
                  {!!preview.meta.wartime_only && <span className="px-2 py-0.5 rounded text-[12px] bg-orange-500/20 text-orange-300 border border-orange-500/30">Воєнний стан</span>}
                  {!!preview.meta.is_suspended && <span className="px-2 py-0.5 rounded text-[12px] bg-red-500/20 text-red-300 border border-red-500/30">Зупинено</span>}
                  {!!preview.meta.has_transitional && <span className="px-2 py-0.5 rounded text-[12px] bg-blue-500/20 text-blue-300 border border-blue-500/30">Перехідні положення</span>}
                </div>
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

// ── Sources tab ────────────────────────────────────────────────────────────────

type SourceInfo = {
  id: string
  label: string
  site: string
  siteUrl: string
  volume: string
  what: string
  why: string
  chunks: string
  truncate: string
  splitter: string
  collection: string
  color: string
}

const SOURCES_INFO: SourceInfo[] = [
  {
    id: "rada",
    label: "Верховна Рада",
    site: "zakon.rada.gov.ua",
    siteUrl: "https://zakon.rada.gov.ua",
    volume: "~15 500 документів",
    what: "Всі закони України, кодекси (ЦК, КК, КЗпП, ГПК тощо), постанови ВР, укази Президента, ратифіковані міжнародні договори. Повне первинне законодавство країни.",
    why: "Основа бази знань. Без Ради бот не знає що таке закон. Усі 13 колекцій Qdrant — це Рада, розбита по галузях (фінанси, цивільне, кримінальне тощо).",
    chunks: "3 000 символів / 300 overlap",
    truncate: "8 000 символів",
    splitter: "MarkdownTextSplitter",
    collection: "13 колекцій: rada_finance, rada_civil, rada_criminal ...",
    color: "border-blue-500/30 bg-blue-500/5",
  },
  {
    id: "kmu",
    label: "Кабінет Міністрів",
    site: "kmu.gov.ua",
    siteUrl: "https://www.kmu.gov.ua",
    volume: "~10 000+ документів",
    what: "Постанови КМУ, розпорядження, накази міністерств. Підзаконні акти виконавчої влади: порядки, правила, ліцензійні умови, тарифи, програми.",
    why: "Більшість практичних питань (ліцензії, дозволи, субсидії, соцвиплати) регулюється саме постановами КМУ, а не законами. Критично для практичних відповідей.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "MarkdownTextSplitter",
    collection: "laws_kmu_v2",
    color: "border-amber-500/30 bg-amber-500/5",
  },
  {
    id: "ccu",
    label: "Конституційний суд",
    site: "ccu.gov.ua",
    siteUrl: "https://ccu.gov.ua",
    volume: "~300–500 документів",
    what: "Рішення і висновки КСУ. Єдиний орган, що тлумачить Конституцію України та скасовує неконституційні норми.",
    why: "Коли закон чи його норма визнана неконституційною — вона не діє. Без КСУ бот може давати посилання на скасовані норми. Також КСУ дає офіційне тлумачення спірних конституційних питань.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_ccu_v2",
    color: "border-purple-500/30 bg-purple-500/5",
  },
  {
    id: "supreme",
    label: "Верховний суд",
    site: "reyestr.court.gov.ua",
    siteUrl: "https://reyestr.court.gov.ua",
    volume: "~1 000+ документів",
    what: "Постанови пленуму Верховного суду, узагальнення судової практики, роз'яснення щодо застосування законів.",
    why: "Показує як закони застосовуються на практиці. Дозволяє боту відповідати не тільки 'що каже закон' а й 'як суди це трактують'. Особливо важливо для спорів.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_supreme_v2",
    color: "border-emerald-500/30 bg-emerald-500/5",
  },
  {
    id: "wiki",
    label: "Legal Aid Wiki",
    site: "legalaid.wiki",
    siteUrl: "https://legalaid.wiki/",
    volume: "кілька тисяч статей",
    what: "Власна MediaWiki-вікі проекту Legal Aid Ukraine. Містить юридичні терміни, визначення понять, пояснення інститутів права українською мовою. Не Вікіпедія — окремий ресурс.",
    why: "Допомагає боту пояснювати терміни простою мовою. Коли користувач запитує 'що таке позовна давність?' — вікі дає чітке визначення без законодавчого жаргону.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_wiki_v2",
    color: "border-gray-500/30 bg-gray-500/5",
  },
  {
    id: "positions",
    label: "Правові позиції ВС",
    site: "lpd.court.gov.ua",
    siteUrl: "https://lpd.court.gov.ua",
    volume: "~12 800 позицій",
    what: "Каталог правових позицій Верховного суду — задокументовані висновки ВС по конкретних категоріях справ. Кожна позиція: формулювання висновку + посилання на справи.",
    why: "Найточніше джерело для відповідей типу 'яка позиція суду щодо X'. Краще за загальні постанови пленуму, бо прив'язане до конкретних обставин справ. Золото для адвокатів.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_positions_v2",
    color: "border-[#C9A84C]/30 bg-[#C9A84C]/5",
  },
  {
    id: "mod",
    label: "Міністерство оборони",
    site: "mod.gov.ua",
    siteUrl: "https://www.mod.gov.ua",
    volume: "~210 документів",
    what: "Накази, порядки та методичні матеріали МОУ з кадрової, фінансової та майнової діяльності. Завантажуються у форматі PDF через Playwright (JS-rendered сайт).",
    why: "Містить покрокові алгоритми дій, специфічні для військової служби: звільнення, грошове забезпечення, оформлення майна. Ексклюзивні дані, яких немає у Раді або КМУ.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_mod_v2",
    color: "border-red-500/30 bg-red-500/5",
  },
  {
    id: "zir",
    label: "ЗІР — Держподаткова служба",
    site: "zir.tax.gov.ua",
    siteUrl: "https://zir.tax.gov.ua/main/bz/search/?src=ques",
    volume: "~5 900 питань-відповідей",
    what: "Офіційні роз'яснення Державної податкової служби у форматі Питання–Відповідь. Чинні публікації по всіх категоріях: ПДВ, ПДФО, єдиний податок, акциз, митниця тощо.",
    why: "Показує як ДПС офіційно трактує Податковий кодекс на практиці. Текст ПКУ і позиція податкової — часто різні речі. Критично для ФОПів, бухгалтерів, бізнесу.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_zir_v2",
    color: "border-teal-500/30 bg-teal-500/5",
  },
]

// ── Fix Truncated tab ──────────────────────────────────────────────────────────

type FixSourceStatus = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume?: boolean
  resume_progress: {
    done: number
    failed: number
    total: number
    current?: { law_id: string; size_kb: number; started_at: string } | null
  } | null
  total_on_disk: number
}

type FixAllStatus = Record<string, FixSourceStatus>

type PipelineStatus = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  last_run: string | null
  step_names: string[]
}

const FIX_SOURCES: { id: string; label: string; threshold: string }[] = [
  { id: "rada", label: "Верховна Рада", threshold: "> 8 KB (старий ліміт 8 000 символів)" },
  { id: "kmu",  label: "Кабінет Міністрів", threshold: "> 15 KB (старий ліміт 15 000 символів)" },
]

const PIPELINE_STEP_NAMES = [
  "Скрапінг (нові документи)",
  "Реіндекс (тільки нові)",
  "Реіндекс великих Rada/KMU документів",
  "Збагачення метаданих OpenData",
  "Видобування текстових скасувань",
  "Застосування текстового кешу",
  "Патч Qdrant payload",
  "Document registry",
]

function fmtPipelineTime(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function PipelineUpdatePanel() {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [error, setError] = useState("")
  const logRef = useRef<HTMLDivElement | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pipeline")
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void fetchStatus() }, 0)
    return () => window.clearTimeout(id)
  }, [fetchStatus])

  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(fetchStatus, 3000)
    return () => clearInterval(id)
  }, [status?.running, fetchStatus])

  useEffect(() => {
    const el = logRef.current
    if (showLogs && el) el.scrollTop = el.scrollHeight
  }, [showLogs, status?.live_logs?.length])

  async function runAction(action: "trigger" | "stop") {
    setError("")
    const res = await fetch("/api/admin/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(String(data.detail || data.error || "Помилка запуску пайплайну"))
      return
    }
    setShowLogs(true)
    await fetchStatus()
  }

  const stepNames = status?.step_names?.length ? status.step_names : PIPELINE_STEP_NAMES
  const totalSteps = stepNames.length
  const { currentStep, completedSteps } = (() => {
    if (!status?.running && status?.last_run) {
      return { currentStep: 0, completedSteps: new Set(Array.from({ length: totalSteps }, (_, i) => i + 1)) }
    }
    const completed = new Set<number>()
    let current = 0
    for (const log of status?.live_logs ?? []) {
      const match = log.message.match(new RegExp(`^\\[(\\d{1,2})\\/${totalSteps}\\]\\s*(▶|✅)`))
      if (!match) continue
      const step = Number(match[1])
      if (match[2] === "▶") current = step
      if (match[2] === "✅") {
        completed.add(step)
        if (current === step) current = 0
      }
    }
    return { currentStep: current, completedSteps: completed }
  })()

  return (
    <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#E0E6ED]">Пайплайн оновлення</span>
            {status?.running && (
              <span className="text-[12px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 animate-pulse">
                Виконується{currentStep ? ` · крок ${currentStep}/${totalSteps}` : ""}
              </span>
            )}
            {!status?.running && status?.last_run && (
              <span className="text-[12px] text-gray-400">Останній: {fmtPipelineTime(status.last_run)}</span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Повний цикл: скрапінг, реіндекс нових файлів, реіндекс великих Rada/KMU документів, OpenData, текстові скасування, патч Qdrant payload і document registry для швидкого пошуку.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            className="p-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-gray-400 hover:text-[#E0E6ED] transition-colors"
            title="Оновити"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {status?.running ? (
            <button
              onClick={() => void runAction("stop")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Зупинити
            </button>
          ) : (
            <button
              onClick={() => void runAction("trigger")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Запустити зараз
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {stepNames.map((name, i) => {
          const step = i + 1
          const done = completedSteps.has(step)
          const active = status?.running && currentStep === step
          return (
            <div
              key={name}
              className={`rounded-xl border px-3 py-2 transition-colors ${
                active
                  ? "border-emerald-400/60 bg-emerald-500/10"
                  : done
                    ? "border-emerald-600/40 bg-emerald-900/20"
                    : "border-white/5 bg-[#0A0E1A]/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-5 shrink-0 text-center text-[12px] font-black ${active || done ? "text-emerald-400" : "text-gray-500"}`}>
                  {done ? "✓" : active ? "▶" : step}
                </span>
                <span className={`text-[12px] leading-tight ${active ? "text-emerald-200" : done ? "text-emerald-500/80" : "text-gray-400"}`}>
                  {name}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setShowLogs(v => !v)}
        className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
      >
        {showLogs ? "▲ Сховати логи" : `▼ Показати логи (${status?.live_logs?.length ?? 0})`}
      </button>

      {showLogs && (
        <div ref={logRef} className="bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 h-56 overflow-y-auto font-mono text-[11px] p-3 space-y-0.5">
          {!status?.live_logs?.length && <div className="text-gray-500">Логів ще немає...</div>}
          {status?.live_logs?.map((log, i) => (
            <div key={i} className={levelColor(log.level)}>
              <span className="text-gray-600 mr-2">{log.ts?.slice(11, 19)}</span>
              {log.message}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
        Після будь-якого реіндексу перебудуй Centroid Router у /admin/sync, щоб routing колекцій відповідав новому Qdrant.
      </div>
    </div>
  )
}

function FixTruncatedTab() {
  const [status, setStatus] = useState<FixAllStatus>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Record<string, string>>({})
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})
  const logRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/fix-truncated/status")
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void fetchStatus() }, 0)
    return () => window.clearTimeout(id)
  }, [fetchStatus])

  const anyRunning = FIX_SOURCES.some(s => status[s.id]?.running)

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (anyRunning) pollRef.current = setInterval(fetchStatus, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [anyRunning, fetchStatus])

  // Auto-scroll logs
  useEffect(() => {
    FIX_SOURCES.forEach(({ id }) => {
      const logsOpen = expandedLogs[id] ?? status[id]?.running
      const el = logRefs.current[id]
      if (logsOpen && el) {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [status, expandedLogs])

  async function handleStart(source: string) {
    setLoading(l => ({ ...l, [source]: true }))
    setError(e => ({ ...e, [source]: "" }))
    try {
      const res = await fetch("/api/admin/v2/fix-truncated/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      const data = await res.json()
      if (!res.ok) setError(e => ({ ...e, [source]: data.detail || data.error || "Помилка" }))
      else { await fetchStatus(); setExpandedLogs(l => ({ ...l, [source]: true })) }
    } catch { setError(e => ({ ...e, [source]: "Помилка з'єднання" })) }
    setLoading(l => ({ ...l, [source]: false }))
  }

  async function handleStop(source: string) {
    try {
      await fetch("/api/admin/v2/fix-truncated/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      })
      await fetchStatus()
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <PipelineUpdatePanel />

      {/* Info */}
      <div className="bg-[#0d1120] rounded-2xl border border-amber-500/20 p-5 space-y-3">
        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Виправлення обрізаних документів</h3>
        <p className="text-sm text-gray-400 leading-relaxed">
          Старий реіндекс обрізав документи: <b className="text-white">rada</b> → 8 000 символів,{" "}
          <b className="text-white">kmu</b> → 15 000 символів. Великі закони (Податковий кодекс 7 MB,
          Митний кодекс 3 MB...) потрапляли в базу тільки першими 2–3 сторінками.
        </p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-center">
            <div className="text-red-300 font-bold text-base">29 225</div>
            <div className="text-gray-400">файлів rada обрізано</div>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 text-center">
            <div className="text-amber-300 font-bold text-base">4 926</div>
            <div className="text-gray-400">файлів &gt;50 KB (критично)</div>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-center">
            <div className="text-emerald-300 font-bold text-base">∞</div>
            <div className="text-gray-400">новий ліміт (повний текст)</div>
          </div>
        </div>
        <div className="text-xs text-gray-500 border-t border-white/5 pt-3">
          ⚠️ Запускати по одному джерелу. Підтримує паузу/відновлення — можна зупинити і продовжити будь-коли.
        </div>
      </div>

      {/* Per-source panels */}
      {FIX_SOURCES.map(({ id, label, threshold }) => {
        const src = status[id]
        const running   = src?.running ?? false
        const stopping  = running && (src?.pause_requested ?? false)
        const progress  = src?.resume_progress
        const totalDisk = src?.total_on_disk ?? 0
        const logs      = src?.live_logs ?? []
        const logsOpen  = expandedLogs[id] ?? running
        const pct       = progress && progress.total > 0
          ? Math.round((progress.done / progress.total) * 100) : 0

        return (
          <div key={id} className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-[#0A0E1A] text-[#C9A84C] px-2 py-0.5 rounded font-bold">{id}</span>
                  <span className="text-sm font-bold text-[#E0E6ED]">{label}</span>
                  {running && !stopping && (
                    <span className="text-xs font-bold text-emerald-400 animate-pulse">● Виконується</span>
                  )}
                  {stopping && (
                    <span className="text-xs font-bold text-amber-400 animate-pulse">⏸ Зупиняється...</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{threshold}</div>
              </div>
              <div className="flex gap-2">
                {!running ? (
                  <button
                    onClick={() => handleStart(id)}
                    disabled={loading[id] || FIX_SOURCES.some(s => s.id !== id && status[s.id]?.running)}
                    className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-xs hover:bg-amber-400 disabled:opacity-40 transition-colors"
                  >
                    {loading[id] ? "..." : progress ? "▶ Продовжити" : "▶ Запустити"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleStop(id)}
                    disabled={stopping}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    ⏸ Пауза
                  </button>
                )}
              </div>
            </div>

            {error[id] && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error[id]}</div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-[#0A0E1A] rounded-lg p-2 text-center">
                <div className="text-[#C9A84C] font-bold text-sm">{totalDisk.toLocaleString()}</div>
                <div className="text-gray-500">файлів для обробки</div>
              </div>
              <div className="bg-[#0A0E1A] rounded-lg p-2 text-center">
                <div className="text-emerald-400 font-bold text-sm">{progress?.done ?? 0}</div>
                <div className="text-gray-500">оброблено</div>
              </div>
              <div className="bg-[#0A0E1A] rounded-lg p-2 text-center">
                <div className="text-red-400 font-bold text-sm">{progress?.failed ?? 0}</div>
                <div className="text-gray-500">помилок</div>
              </div>
            </div>

            {progress?.current && (
              <div className="rounded-lg border border-[#C9A84C]/15 bg-[#0A0E1A] px-3 py-2 text-xs text-gray-400">
                <div className="font-bold text-[#E0E6ED]">Поточний документ</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>ID: <b className="text-[#C9A84C]">{progress.current.law_id}</b></span>
                  <span>Розмір: <b className="text-gray-300">{progress.current.size_kb.toLocaleString()} KB</b></span>
                  <span>Етапи видно у логах нижче: читання, чанки, embedding, видалення старого, upload.</span>
                </div>
              </div>
            )}

            {/* Progress bar */}
            {progress && progress.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{progress.done} / {progress.total}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 bg-[#0A0E1A] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#C9A84C] rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Logs toggle */}
            {(running || logs.length > 0) && (
              <div className="space-y-2">
                <button
                  onClick={() => setExpandedLogs(l => ({ ...l, [id]: !logsOpen }))}
                  className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                >
                  {expandedLogs[id] ? "▲ Сховати логи" : `▼ Показати логи (${logs.length})`}
                </button>
                {logsOpen && (
                  <div
                    ref={el => { logRefs.current[id] = el }}
                    className="h-56 overflow-y-auto overscroll-contain bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-3 font-mono text-[11px] space-y-0.5"
                  >
                    {logs.length === 0 && (
                      <div className="text-gray-500">Очікування першого запису з backend...</div>
                    )}
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        className={
                          log.level === "error" ? "text-red-400" :
                          log.level === "warning" ? "text-amber-400" :
                          "text-gray-300"
                        }
                      >
                        <span className="text-gray-600 mr-2">{log.ts?.slice(11, 19)}</span>
                        {log.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SourcesTab() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#0d1120] rounded-2xl border border-[#C9A84C]/20 p-5 space-y-2">
        <h2 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Що ми скрапимо і навіщо</h2>
        <p className="text-sm text-gray-400">
          База знань URAI складається з 8 джерел. Кожне джерело — окремий тип юридичної інформації
          з власним скрапером, форматом зберігання і колекцією Qdrant.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-xs text-gray-400">
          <div><span className="text-[#C9A84C] font-bold">~40 000+</span> документів загалом</div>
          <div><span className="text-[#C9A84C] font-bold">8</span> джерел скрапінгу</div>
          <div><span className="text-[#C9A84C] font-bold">20</span> колекцій Qdrant v2</div>
        </div>
      </div>

      {/* Source cards */}
      <div className="space-y-4">
        {SOURCES_INFO.map(src => (
          <div key={src.id} className={`rounded-2xl border p-5 space-y-4 ${src.color}`}>
            {/* Title row */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-[#0A0E1A]/60 text-[#C9A84C] px-2 py-0.5 rounded font-bold">{src.id}</span>
                  <h3 className="text-sm font-bold text-[#E0E6ED]">{src.label}</h3>
                </div>
                <a
                  href={src.siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
                >
                  {src.site} ↗
                </a>
              </div>
              <span className="shrink-0 text-xs font-bold text-[#C9A84C] bg-[#C9A84C]/10 border border-[#C9A84C]/20 px-2 py-1 rounded-lg">
                {src.volume}
              </span>
            </div>

            {/* What / Why */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[12px] font-bold text-gray-400 uppercase tracking-wider">Що містить</div>
                <p className="text-xs text-[#E0E6ED]/80 leading-relaxed">{src.what}</p>
              </div>
              <div className="space-y-1">
                <div className="text-[12px] font-bold text-amber-500/70 uppercase tracking-wider">Навіщо боту</div>
                <p className="text-xs text-[#E0E6ED]/80 leading-relaxed">{src.why}</p>
              </div>
            </div>

            {/* Technical params */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-400 border-t border-white/5 pt-3">
              <span>Чанк: <b className="text-gray-400">{src.chunks}</b></span>
              <span>Truncate: <b className="text-gray-400">{src.truncate}</b></span>
              <span>Splitter: <b className="text-gray-400">{src.splitter}</b></span>
              <span>Колекція: <b className="text-gray-400">{src.collection}</b></span>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline reminder */}
      <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-3">
        <h3 className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">Порядок роботи з даними</h3>
        <div className="space-y-2">
          {[
            { step: "1", label: "Скрапінг", desc: "Вкладка Скрапер — завантажує тексти на диск у /root/laws_raw/{source}/", color: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
            { step: "2", label: "Реіндекс", desc: "Вкладка Реіндекс — читає з диску, ділить на чанки, ембедить через gemini-embedding-001, завантажує у Qdrant _v2 колекції", color: "bg-amber-500/20 text-amber-300 border border-amber-500/30" },
            { step: "3", label: "Перевірка", desc: "Вкладка Аналітика — порівнює кількість файлів на диску з кількістю векторів у Qdrant, виявляє прогалини", color: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
          ].map(({ step, label, desc, color }) => (
            <div key={step} className="flex gap-3 items-start">
              <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${color}`}>{step}</span>
              <div>
                <span className="text-sm font-semibold text-[#E0E6ED]">{label}</span>
                <span className="text-xs text-gray-400"> — {desc}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-400 border-t border-[#C9A84C]/10 pt-3">
          Правило: завжди спочатку скрапінг, потім реіндекс. Реіндекс читає файли один раз на старті — нові файли після запуску не підхоплюються.
        </div>
      </div>
    </div>
  )
}

type Tab = "scraper" | "reindex" | "analytics" | "disk" | "sources" | "fix"

const TABS: { id: Tab; label: string }[] = [
  { id: "scraper", label: "Скрапер" },
  { id: "reindex", label: "Реіндекс" },
  { id: "fix",     label: "Виправлення" },
  { id: "analytics", label: "Аналітика" },
  { id: "disk", label: "Диск" },
  { id: "sources", label: "Джерела" },
]

export default function V2AdminPage() {
  const [tab, setTab] = useState<Tab>("scraper")

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">V2 Панель</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            gemini-embedding-001 · 3072 dims · 20 колекцій _v2
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-[#111827] rounded-xl border border-[#C9A84C]/10 p-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[70px] py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors whitespace-nowrap ${tab === t.id
                ? "bg-[#C9A84C] text-[#0A0E1A]"
                : "text-gray-400 hover:text-[#E0E6ED]"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "scraper" && <ScraperTab />}
        {tab === "reindex" && <ReindexTab />}
        {tab === "fix" && <FixTruncatedTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "disk" && <DiskTab />}
        {tab === "sources" && <SourcesTab />}
      </div>
    </div>
  )
}
