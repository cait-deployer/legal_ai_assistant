"use client"

import { useState, useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = { ts: string; message: string; level: string }
type ReindexStats = Record<string, { laws?: number; chunks?: number; uploaded?: number; errors?: number }>
type ReindexResumeProgress = { file_idx: number; stats: ReindexStats }
type ReindexSourceState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  can_resume: boolean
  resume_progress: ReindexResumeProgress | null
}
type AllReindexStatus = Record<string, ReindexSourceState>

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]

const SOURCE_LABELS: Record<string, string> = {
  rada: "Верховна Рада (~15 500 законів)",
  kmu: "Кабінет Міністрів",
  ccu: "Конституційний суд",
  supreme: "Верховний суд",
  wiki: "Legal Aid Wiki",
  positions: "Правові позиції ВС (~12 800 позицій)",
  mod: "Міністерство оборони (~210 документів)",
  zir: "ЗІР ДПС (~5 900 питань-відповідей)",
}

const DEFAULT_STATE: ReindexSourceState = {
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
    <div ref={containerRef} onScroll={handleScroll}
      className="font-mono text-[11px] h-[400px] overflow-y-auto bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 p-3 space-y-0.5">
      {logs.length === 0 && <span className="text-gray-400">Очікування запуску...</span>}
      {logs.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-gray-400 shrink-0">{new Date(l.ts).toLocaleTimeString("uk-UA")}</span>
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
      <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Зупиняється
      </span>
    )
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Виконується
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-gray-500/20 text-gray-400 border border-gray-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Зупинено
    </span>
  )
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

  useEffect(() => {
    if (prevRunning.current && !state.running) setStoppedAt(new Date().toLocaleTimeString("uk-UA"))
    prevRunning.current = state.running
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
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-bold text-[#E0E6ED] uppercase tracking-wider">{source}</span>
          <span className="ml-2 text-xs text-gray-400 hidden sm:inline">{SOURCE_LABELS[source]}</span>
        </div>
        <RunningBadge running={state.running} paused={state.pause_requested} />
      </div>

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

      <div className="flex gap-2 flex-wrap">
        {!state.running && !state.can_resume && (
          <button onClick={() => doTrigger(false)} disabled={loading || collectionsReady === false}
            className="px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-xs hover:bg-[#d4b460] disabled:opacity-50 transition-colors">
            ▶ Запустити
          </button>
        )}
        {!state.running && state.can_resume && (
          <>
            <button onClick={doResume} disabled={loading || collectionsReady === false}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-xs hover:bg-emerald-800 disabled:opacity-50 transition-colors">
              ▶ Продовжити
            </button>
            <button onClick={() => doTrigger(true)} disabled={loading || collectionsReady === false}
              className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] disabled:opacity-50 transition-colors">
              Почати заново
            </button>
          </>
        )}
        {state.running && !state.pause_requested && (
          <button onClick={doStop} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold text-xs hover:bg-red-700 disabled:opacity-50 transition-colors">
            ⏸ Зупинити
          </button>
        )}
        {state.live_logs.length > 0 && (
          <button onClick={() => setLogsOpen(o => !o)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
            {logsOpen ? "▲ Сховати логи" : "▼ Логи"}
          </button>
        )}
      </div>

      {logsOpen && state.live_logs.length > 0 && (
        <>
          {state.running && state.pause_requested && (
            <span className="text-xs text-amber-400 animate-pulse">Зупиняється, чекаємо завершення батчу...</span>
          )}
          {state.running && !state.pause_requested && (
            <span className="text-xs text-emerald-400 animate-pulse">Виконується...</span>
          )}
          <LogPanel logs={state.live_logs} />
        </>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ReindexPage() {
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
    fetchStatus()
    checkCollections()
  }, [fetchStatus, checkCollections])

  const anyRunning = SOURCES.some(s => allStatus[s]?.running)
  const anyStopping = SOURCES.some(s => allStatus[s]?.running && allStatus[s]?.pause_requested)

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (anyStopping) pollRef.current = setInterval(fetchStatus, 1500)
    else if (anyRunning) pollRef.current = setInterval(fetchStatus, 3000)
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
      if (!res.ok) setInitError(data.detail || data.error || "Помилка")
      else { await fetchStatus(); await checkCollections() }
    } catch { setInitError("Помилка з'єднання") }
    setInitLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Реіндекс</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">Крок 2 — диск → чанки → gemini-embedding-001 → Qdrant v2</p>
        </div>

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
                <span className="text-gray-400"> — читає тексти з диску, ділить на чанки, ембедить, завантажує у Qdrant. </span>
                <span className="text-amber-400 font-medium">Тільки одне джерело може працювати одночасно.</span>
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-400 border-t border-[#C9A84C]/10 pt-3">
            ⚠️ Запускай реіндекс тільки після завершення скрапінгу (<a href="/admin/scraper" className="text-[#C9A84C] hover:underline">Скрапер</a>)
          </div>
        </div>

        {collectionsReady === false && (
          <div className="bg-[#111827] rounded-2xl border border-amber-500/20 p-5 space-y-3">
            <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Крок 1 — Ініціалізація колекцій</h3>
            <p className="text-sm text-gray-400">Колекції ще не створені. Натисни кнопку — займе 5-10 секунд.</p>
            {initError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{initError}</div>
            )}
            <button onClick={handleInit} disabled={initLoading || anyRunning}
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {initLoading ? "Створення..." : "🗂️ Створити 20 колекцій Qdrant"}
            </button>
          </div>
        )}

        {collectionsReady === true && (
          <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/20 px-4 py-3 text-sm text-emerald-300 font-medium flex items-center justify-between">
            <span>✅ 20 _v2 колекцій Qdrant існують. Крок 1 виконано.</span>
            <button onClick={fetchStatus} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Оновити</button>
          </div>
        )}

        {collectionsReady !== false && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#E0E6ED]">Крок 2 — Реіндекс по джерелах</h3>
              <button onClick={fetchStatus}
                className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-xs hover:bg-[#1e293b] transition-colors">
                Оновити
              </button>
            </div>
            {SOURCES.map(src => (
              <ReindexSourcePanel
                key={src}
                source={src}
                state={allStatus[src] ?? DEFAULT_STATE}
                collectionsReady={collectionsReady}
                onRefresh={fetchStatus}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
