"use client"

import { useState, useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = { ts: string; message: string; level: string }
type ScrapeSourceStats = { ok?: number; empty?: number; restricted?: number; error?: number; skipped?: number }
type ScrapeResumeProgress = { inner_idx: number; stats: ScrapeSourceStats }
type SourceState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ScrapeResumeProgress | null
}
type AllSourcesStatus = Record<string, SourceState>

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]

const RADA_COLLECTIONS = [
  "rada_finance", "rada_state", "rada_personnel", "rada_court",
  "rada_intl", "rada_labor", "rada_civil", "rada_criminal",
  "rada_admin", "rada_housing", "rada_land", "rada_industry", "rada_other",
]

const SOURCE_LABELS: Record<string, string> = {
  rada:      "Верховна Рада (~15 500 законів)",
  kmu:       "Кабінет Міністрів",
  ccu:       "Конституційний суд",
  supreme:   "Верховний суд",
  wiki:      "Legal Aid Wiki (юридичні терміни)",
  positions: "Правові позиції ВС (~12 800 позицій)",
  mod:       "Міністерство оборони (~210 документів)",
  zir:       "ЗІР ДПС (~5 900 питань-відповідей)",
}

const DEFAULT_SOURCE_STATE: SourceState = {
  running: false, pause_requested: false, live_logs: [], can_resume: false, resume_progress: null,
}

// ── LogPanel ───────────────────────────────────────────────────────────────────

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
      {logs.length === 0 && <span className="text-gray-600">Очікування запуску...</span>}
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gray-600 shrink-0">{new Date(l.ts).toLocaleTimeString("uk-UA")}</span>
          <span className={levelColor(l.level)}>{l.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── RunningBadge ───────────────────────────────────────────────────────────────

function RunningBadge({ running, paused }: { running: boolean; paused: boolean }) {
  if (running && paused)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Зупиняється
      </span>
    )
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Виконується
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-gray-500/20 text-gray-400 border border-gray-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Зупинено
    </span>
  )
}

// ── SourcePanel ────────────────────────────────────────────────────────────────

function SourcePanel({ source, state, onRefresh }: {
  source: string
  state: SourceState
  onRefresh: () => Promise<void>
}) {
  const [logsOpen, setLogsOpen] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState("")
  const [radaCol, setRadaCol]   = useState("")

  const stats = state.resume_progress?.stats ?? {}
  const idx   = state.resume_progress?.inner_idx ?? 0

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
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-bold text-[#E0E6ED] uppercase tracking-wider">{source}</span>
          <span className="ml-2 text-xs text-gray-500 hidden sm:inline">{SOURCE_LABELS[source]}</span>
        </div>
        <RunningBadge running={state.running} paused={state.pause_requested} />
      </div>

      {state.resume_progress && (
        <div className="space-y-1">
          <div className="grid grid-cols-5 gap-1 text-center">
            {(["ok","empty","restricted","error","skipped"] as const).map(k => {
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
                  <div className="text-[10px] opacity-70">{labels[k]}</div>
                </div>
              )
            })}
          </div>
          <div className="text-xs text-gray-500">Позиція: <b className="text-gray-300">{idx}</b></div>
        </div>
      )}

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

      {logsOpen && state.live_logs.length > 0 && <LogPanel logs={state.live_logs} />}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ScraperPage() {
  const [allStatus, setAllStatus] = useState<AllSourcesStatus>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/v2/scrape/status")
      if (res.ok) setAllStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

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
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Скрапер</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Крок 1 — завантаження текстів на диск /root/laws_raw/</p>
          </div>
          <button onClick={fetchStatus}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
            Оновити
          </button>
        </div>

        <div className="bg-[#0d1120] rounded-xl border border-[#C9A84C]/10 px-4 py-3 text-xs text-gray-400">
          Після завершення скрапінгу перейди до <a href="/admin/reindex" className="text-[#C9A84C] hover:underline">Реіндексу</a> для завантаження в Qdrant.
        </div>

        <div className="space-y-3">
          {SOURCES.map(src => (
            <SourcePanel
              key={src}
              source={src}
              state={allStatus[src] ?? DEFAULT_SOURCE_STATE}
              onRefresh={fetchStatus}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
