"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { RefreshCw, Play, Square, RotateCcw, AlertCircle, Clock, Save, ChevronRight, Info, Cpu, SkipForward } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type LogEntry = { ts: string; message: string; level: string }

type ScrapeSourceStatus = {
  running: boolean
  pause_requested: boolean
  can_resume: boolean
  resume_progress: { inner_idx: number; stats: Record<string, number> } | null
  live_logs: LogEntry[]
}

type ReindexSourceStatus = {
  running: boolean
  pause_requested: boolean
  can_resume: boolean
  resume_state: { file_idx: number; stats: Record<string, number> } | null
  live_logs: LogEntry[]
}

type DiskSource   = { files: number; size_mb: number }
type SyncStatus   = { schedule_hour: number; sources: Record<string, { enabled: boolean; running: boolean; last_sync: string | null }> }
type CentroidInfo = { building: boolean; ready: boolean; built_at: string | null; total_collections: number }

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"] as const
type Source = typeof SOURCES[number]

const SRC: Record<Source, { label: string; expected: number; note?: string }> = {
  rada:      { label: "Верховна Рада",       expected: 15500 },
  kmu:       { label: "Кабінет Міністрів",   expected: 10000 },
  ccu:       { label: "Конституційний суд",  expected: 500   },
  supreme:   { label: "Верховний суд",       expected: 1000  },
  wiki:      { label: "Legal Aid Wiki",      expected: 3000  },
  positions: { label: "Правові позиції ВС",  expected: 12800 },
  mod:       { label: "МОУ (PDF)",           expected: 210, note: "Playwright + OCR, ~30хв" },
  zir:       { label: "ЗІР ДПС",            expected: 5900  },
}

const SRC_COLS: Record<Source, string[]> = {
  rada:      ["rada_finance_v2","rada_state_v2","rada_personnel_v2","rada_court_v2","rada_intl_v2","rada_labor_v2","rada_civil_v2","rada_criminal_v2","rada_admin_v2","rada_housing_v2","rada_land_v2","rada_industry_v2","rada_other_v2"],
  kmu:       ["laws_kmu_v2"],
  ccu:       ["laws_ccu_v2"],
  supreme:   ["laws_supreme_v2"],
  wiki:      ["laws_wiki_v2"],
  positions: ["laws_positions_v2"],
  mod:       ["laws_mod_v2"],
  zir:       ["laws_zir_v2"],
}

const LOG_COLOR: Record<string, string> = {
  error:   "text-red-400",
  warning: "text-amber-400",
  info:    "text-[#E0E6ED]",
  success: "text-emerald-400",
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtNum(n: number) { return n > 0 ? n.toLocaleString("uk-UA") : "—" }
function fmtTime(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function StatusDot({ running, canResume }: { running: boolean; canResume: boolean }) {
  if (running) return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
  if (canResume) return <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
  return <span className="inline-block w-2 h-2 rounded-full bg-gray-700" />
}

function StatusLabel({ running, canResume, pauseRequested }: { running: boolean; canResume: boolean; pauseRequested: boolean }) {
  if (running && pauseRequested) return <span className="text-[10px] text-amber-400">Зупиняється</span>
  if (running) return <span className="text-[10px] text-emerald-400">Виконується</span>
  if (canResume) return <span className="text-[10px] text-amber-400">Призупинено</span>
  return <span className="text-[10px] text-gray-600">Idle</span>
}

// ── Log Panel ──────────────────────────────────────────────────────────────────

function LogPanel({
  title,
  logs,
  onStop,
  onResume,
  running,
  canResume,
  onClose,
}: {
  title: string
  logs: LogEntry[]
  onStop?: () => void
  onResume?: () => void
  running: boolean
  canResume: boolean
  onClose: () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs.length])

  return (
    <div className="bg-[#080d16] rounded-2xl border border-[#C9A84C]/20 overflow-hidden">
      {/* Log header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-[#0d1120]">
        <div className="flex items-center gap-2">
          {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          <span className="text-xs font-mono font-bold text-[#C9A84C]">{title}</span>
          <span className="text-[10px] text-gray-600">{logs.length} рядків</span>
        </div>
        <div className="flex items-center gap-2">
          {canResume && !running && onResume && (
            <button onClick={onResume} className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded transition-colors">
              <SkipForward className="w-3 h-3" /> Продовжити
            </button>
          )}
          {running && onStop && (
            <button onClick={onStop} className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded transition-colors">
              <Square className="w-3 h-3" /> Зупинити
            </button>
          )}
          <button onClick={onClose} className="text-[10px] text-gray-600 hover:text-gray-400 px-2 py-1 rounded hover:bg-white/5 transition-colors">✕</button>
        </div>
      </div>
      {/* Logs */}
      <div className="h-52 overflow-y-auto font-mono text-[11px] p-3 space-y-0.5">
        {logs.length === 0 && <div className="text-gray-600 text-center pt-8">Логів ще немає...</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-700 shrink-0">{l.ts?.slice(11, 19) || ""}</span>
            <span className={LOG_COLOR[l.level] ?? "text-gray-400"}>{l.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Centroid widget ────────────────────────────────────────────────────────────

function CentroidWidget({ needsRebuild }: { needsRebuild: boolean }) {
  const [status, setStatus]         = useState<CentroidInfo | null>(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError]           = useState("")

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/centroid/status")
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  async function handleRebuild() {
    setRebuilding(true); setError("")
    try {
      const res = await fetch("/api/admin/centroid/rebuild", { method: "POST" })
      if (!res.ok) { const d = await res.json(); setError(d.detail || "Помилка") }
      else { await fetchStatus() }
    } catch { setError("Помилка з'єднання") }
    setRebuilding(false)
  }

  const isReady    = status?.ready && !status?.building
  const isBuilding = status?.building

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${needsRebuild && isReady ? "border-amber-500/30 bg-amber-500/5" : "border-[#C9A84C]/10 bg-[#111827]"}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5 text-[#C9A84C]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[#E0E6ED]">Centroid Router</span>
              {isBuilding && <span className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">Будується...</span>}
              {isReady && <span className="text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">● Активний</span>}
              {needsRebuild && isReady && <span className="text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">⚠ Потрібне перебудування</span>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Семантичний routing → правильні Qdrant колекції для кожного запиту
              {status?.built_at && <span className="ml-2 text-gray-600">· {fmtTime(status.built_at)} · {status.total_collections} кол.</span>}
            </div>
            <div className="text-[10px] text-amber-500/70 mt-1">
              ⚠ Обов&apos;язково перебудувати після кожного реіндексу
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchStatus} className="p-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-gray-400 hover:text-[#E0E6ED] transition-colors" title="Оновити">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRebuild}
            disabled={rebuilding || isBuilding}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#C9A84C]/10 border border-[#C9A84C]/25 text-[#C9A84C] text-xs font-bold hover:bg-[#C9A84C]/20 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {rebuilding ? "Запуск..." : "Перебудувати"}
          </button>
        </div>
      </div>
      {error && <div className="mt-3 flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}</div>}
    </div>
  )
}

// ── Schedule widget ────────────────────────────────────────────────────────────

const SCHEDULE_META: Record<string, string> = {
  rada: "Верховна Рада (legacy V1)", kmu: "Кабінет Міністрів",
  ccu: "КСУ", supreme: "Верховний суд",
  wiki: "Legal Aid Wiki", positions: "Правові позиції ВС",
  mod: "МОУ (PDF, Playwright)", zir: "ЗІР ДПС",
}

function ScheduleWidget() {
  const [status, setStatus]   = useState<SyncStatus | null>(null)
  const [hour, setHour]       = useState(1)
  const [sources, setSources] = useState<Record<string, boolean>>({})
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState("")

  const fetchStatus = useCallback(async (forceOverwrite = false) => {
    try {
      const res = await fetch("/api/admin/sync/status")
      if (res.ok) {
        const d: SyncStatus = await res.json()
        setStatus(d)
        // не перезаписуємо локальні зміни якщо користувач щось потикав
        if (forceOverwrite || !isDirty) {
          setHour(d.schedule_hour)
          const init: Record<string, boolean> = {}
          for (const [src, s] of Object.entries(d.sources)) init[src] = s.enabled
          setSources(init)
        }
      }
    } catch { /* ignore */ }
  }, [isDirty])

  useEffect(() => { fetchStatus(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true); setError(""); setSaved(false)
    try {
      const res = await fetch("/api/admin/sync/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_hour: hour, sources }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || "Помилка") }
      else {
        setIsDirty(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        await fetchStatus(true)
      }
    } catch { setError("Помилка з'єднання") }
    setSaving(false)
  }

  function handleToggle(src: string) {
    setSources(prev => ({ ...prev, [src]: !prev[src] }))
    setIsDirty(true)
  }

  function handleHourChange(val: number) {
    setHour(val)
    setIsDirty(true)
  }

  const anyEnabled = Object.values(sources).some(Boolean)

  return (
    <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#C9A84C]" />
          <span className="text-sm font-bold text-[#E0E6ED]">Авто-синхронізація</span>
          {anyEnabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Активна</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchStatus(false)} className="p-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-gray-400 hover:text-[#E0E6ED] transition-colors"><RefreshCw className="w-3 h-3" /></button>
          <button onClick={handleSave} disabled={saving} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-colors ${isDirty ? "bg-[#C9A84C]/20 border border-[#C9A84C]/50 text-[#C9A84C] hover:bg-[#C9A84C]/30" : "bg-[#C9A84C]/10 border border-[#C9A84C]/25 text-[#C9A84C] hover:bg-[#C9A84C]/20"}`}>
            <Save className="w-3 h-3" />
            {saving ? "Збереження..." : saved ? "Збережено ✓" : isDirty ? "Зберегти *" : "Зберегти"}
          </button>
        </div>
      </div>

      {/* Warning */}
      <div className="flex gap-2 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2.5">
        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/80 leading-relaxed">
          <span className="font-bold text-amber-300">Авто-синхронізація запускає ТІЛЬКИ скрапінг</span> — завантажує нові файли на диск.<br />
          Після нічного скрапінгу <span className="font-bold">реіндекс і перебудову роутера запускай вручну</span> зі сторінки Реіндекс.
        </div>
      </div>

      {/* Hour */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 shrink-0">Щодня о:</span>
        <select value={hour} onChange={e => handleHourChange(Number(e.target.value))}
          className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-2 py-1 text-xs text-[#E0E6ED] focus:outline-none focus:border-[#C9A84C]/40">
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{String(i).padStart(2, "0")}:00 UTC</option>
          ))}
        </select>
        <span className="text-[10px] text-gray-600">для всіх ввімкнених джерел нижче</span>
      </div>

      {/* Per-source toggles */}
      {!status ? (
        <div className="text-xs text-gray-600">Завантаження...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(SCHEDULE_META).map(([src, label]) => {
            const s = status.sources[src]
            return (
              <div key={src} className="flex items-center justify-between gap-2 bg-[#0d1120] rounded-xl px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-[#E0E6ED]">{label}</div>
                  <div className="text-[10px] text-gray-600">
                    {s?.last_sync ? `Останній: ${fmtTime(s.last_sync)}` : "Ще не запускалось"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s?.running && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">▶ Зараз</span>}
                  <button
                    onClick={() => handleToggle(src)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${sources[src] ? "bg-[#C9A84C]" : "bg-gray-700"}`}
                    aria-label={sources[src] ? "Вимкнути" : "Ввімкнути"}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${sources[src] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}</div>}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function SyncPage() {
  const [scrapeStatus, setScrapeStatus] = useState<Record<string, ScrapeSourceStatus>>({})
  const [reindxStatus, setReindxStatus] = useState<Record<string, ReindexSourceStatus>>({})
  const [diskData, setDiskData]         = useState<Record<string, DiskSource>>({})
  const [qdrantCounts, setQdrantCounts] = useState<Record<string, number>>({})
  const [lawCounts,   setLawCounts]   = useState<Record<string, number>>({})
  const [refreshing, setRefreshing]     = useState(false)
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null)
  const [needsRebuild, setNeedsRebuild] = useState(false)

  // Active log panel: {src, type}
  const [activeLog, setActiveLog] = useState<{ src: string; type: "scrape" | "reindex" } | null>(null)
  const [actionError, setActionError] = useState<string>("")

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [scrR, reiR, diskR, anlR] = await Promise.allSettled([
        fetch("/api/admin/v2/scrape/status"),
        fetch("/api/admin/v2/reindex/status"),
        fetch("/api/admin/v2/disk"),
        fetch("/api/admin/v2/analytics?limit=1"),
      ])
      if (scrR.status === "fulfilled" && scrR.value.ok)  setScrapeStatus(await scrR.value.json())
      if (reiR.status === "fulfilled" && reiR.value.ok)  setReindxStatus(await reiR.value.json())
      if (diskR.status === "fulfilled" && diskR.value.ok) { const d = await diskR.value.json(); setDiskData(d.sources ?? {}) }
      if (anlR.status === "fulfilled" && anlR.value.ok)  { const d = await anlR.value.json(); setQdrantCounts(d.qdrant_v2 ?? {}); setLawCounts(d.qdrant_v2_laws ?? {}) }
      setLastRefresh(new Date())
    } catch { /* ignore */ }
    if (!silent) setRefreshing(false)
  }, [])

  // Initial fetch
  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-poll when something is running
  const anyRunning = SOURCES.some(s =>
    scrapeStatus[s]?.running || reindxStatus[s]?.running
  )
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => fetchAll(true), 2500)
    return () => clearInterval(id)
  }, [anyRunning, fetchAll])

  // Auto-open log panel when a process starts
  useEffect(() => {
    if (!anyRunning || activeLog) return
    const runningSrc = SOURCES.find(s => scrapeStatus[s]?.running || reindxStatus[s]?.running)
    if (!runningSrc) return
    const type = scrapeStatus[runningSrc]?.running ? "scrape" : "reindex"
    setActiveLog({ src: runningSrc, type })
  }, [anyRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────

  async function startScrape(src: string) {
    setActionError("")
    const res = await fetch("/api/admin/v2/scrape/trigger", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    if (!res.ok) { const d = await res.json(); setActionError(d.detail || d.error || "Помилка"); return }
    setActiveLog({ src, type: "scrape" })
    fetchAll(true)
  }

  async function stopScrape(src: string) {
    await fetch("/api/admin/v2/scrape/stop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    fetchAll(true)
  }

  async function resumeScrape(src: string) {
    setActionError("")
    const res = await fetch("/api/admin/v2/scrape/resume", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    if (!res.ok) { const d = await res.json(); setActionError(d.detail || d.error || "Помилка"); return }
    setActiveLog({ src, type: "scrape" })
    fetchAll(true)
  }

  async function startReindex(src: string) {
    setActionError("")
    const res = await fetch("/api/admin/v2/reindex/trigger", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    if (!res.ok) { const d = await res.json(); setActionError(d.detail || d.error || "Помилка"); return }
    setActiveLog({ src, type: "reindex" })
    setNeedsRebuild(true)
    fetchAll(true)
  }

  async function stopReindex(src: string) {
    await fetch("/api/admin/v2/reindex/stop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    fetchAll(true)
  }

  async function resumeReindex(src: string) {
    setActionError("")
    const res = await fetch("/api/admin/v2/reindex/resume", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: src }),
    })
    if (!res.ok) { const d = await res.json(); setActionError(d.detail || d.error || "Помилка"); return }
    setActiveLog({ src, type: "reindex" })
    fetchAll(true)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getQdrant(src: Source): number {
    return SRC_COLS[src].reduce((sum, col) => sum + (qdrantCounts[col] ?? 0), 0)
  }

  function getActiveLogs(): LogEntry[] {
    if (!activeLog) return []
    if (activeLog.type === "scrape") return scrapeStatus[activeLog.src]?.live_logs ?? []
    return reindxStatus[activeLog.src]?.live_logs ?? []
  }

  function getActiveRunning(): boolean {
    if (!activeLog) return false
    if (activeLog.type === "scrape") return scrapeStatus[activeLog.src]?.running ?? false
    return reindxStatus[activeLog.src]?.running ?? false
  }

  function getActiveCanResume(): boolean {
    if (!activeLog) return false
    if (activeLog.type === "scrape") return scrapeStatus[activeLog.src]?.can_resume ?? false
    return reindxStatus[activeLog.src]?.can_resume ?? false
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Керування базою знань</h1>
            <p className="text-xs text-gray-500 mt-1">
              Скрапінг · Реіндекс · Авто-синхронізація
              {lastRefresh && <span className="ml-2 text-gray-700">· {lastRefresh.toLocaleTimeString("uk-UA")}</span>}
            </p>
          </div>
          <button onClick={() => fetchAll()} disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#111827] border border-[#C9A84C]/15 text-sm hover:border-[#C9A84C]/30 disabled:opacity-50 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Оновити
          </button>
        </div>

        {/* ── Workflow Guide ────────────────────────────────────────────────── */}
        <div className="bg-[#0d1120] rounded-2xl border border-[#C9A84C]/15 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Info className="w-3.5 h-3.5 text-[#C9A84C]" />
            <span className="text-xs font-bold text-[#C9A84C] uppercase tracking-wide">Порядок оновлення — обов&apos;язковий</span>
          </div>
          <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
            {[
              { n: "1", color: "text-blue-400 border-blue-500/30 bg-blue-500/10", title: "Скрапінг", desc: "Завантажує нові та оновлені документи на диск (/root/laws_raw/). Пропускає вже існуючі." },
              { n: "→", color: "text-gray-700", title: "", desc: "" },
              { n: "2", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", title: "Реіндекс", desc: "Читає файли з диску, ділить на чанки, векторизує і заливає в Qdrant. Виконується після скрапінгу." },
              { n: "→", color: "text-gray-700", title: "", desc: "" },
              { n: "3", color: "text-purple-400 border-purple-500/30 bg-purple-500/10", title: "Перебудова роутера", desc: "Оновлює centroid router — вказує боту які колекції шукати для кожного запиту." },
            ].map((s, i) =>
              s.title ? (
                <div key={i} className={`flex-1 min-w-0 rounded-xl border px-3 py-2.5 ${s.color}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-black ${s.color.split(" ")[0]}`}>{s.n}</span>
                    <span className="text-xs font-bold text-[#E0E6ED]">{s.title}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              ) : (
                <ChevronRight key={i} className="w-4 h-4 text-gray-700 mt-3 shrink-0 hidden sm:block" />
              )
            )}
          </div>
          <div className="mt-3 text-[10px] text-red-400/70">
            ⚠ Пропустити будь-який крок = бот отримує неповні або застарілі дані. Всі три кроки обов&apos;язкові.
          </div>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {actionError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0" /> {actionError}
            <button onClick={() => setActionError("")} className="ml-auto text-gray-600 hover:text-gray-400">✕</button>
          </div>
        )}

        {/* ── Source table ──────────────────────────────────────────────────── */}
        <div className="bg-[#111827] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <span className="text-xs font-bold text-[#C9A84C] uppercase tracking-wide">Джерела</span>
            <span className="text-[10px] text-gray-600">Натисни на рядок → логи у панелі нижче</span>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 px-4 py-2 border-b border-white/5 text-[10px] text-gray-600 uppercase tracking-wide">
            <span>Джерело</span>
            <span className="text-right w-20">Файлів на диску</span>
            <span className="text-right w-20">Чанків у Qdrant</span>
            <span className="text-center w-20">Скрапер</span>
            <span className="text-center w-20">Реіндекс</span>
            <span className="text-right w-32">Дії</span>
          </div>

          {/* Rows */}
          {SOURCES.map(src => {
            const sc  = scrapeStatus[src]
            const ri  = reindxStatus[src]
            const disk = diskData[src]?.files ?? 0
            const qdrant = getQdrant(src)
            const meta = SRC[src]

            const isActiveLog = activeLog?.src === src
            const diskPct = meta.expected > 0 ? Math.min(disk / meta.expected, 1) : 0
            const qdrantOk = qdrant > 0

            return (
              <div
                key={src}
                onClick={() => setActiveLog(prev => (prev?.src === src ? null : { src, type: sc?.running ? "scrape" : ri?.running ? "reindex" : "scrape" }))}
                className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 px-4 py-3 border-b border-white/5 cursor-pointer transition-colors ${isActiveLog ? "bg-[#C9A84C]/5" : "hover:bg-white/3"}`}
              >
                {/* Source name */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-gray-600 bg-[#0A0E1A] px-1 rounded">{src}</span>
                    <span className="text-xs font-semibold text-[#E0E6ED] truncate">{meta.label}</span>
                    {meta.note && <span className="text-[10px] text-gray-700 hidden sm:inline">({meta.note})</span>}
                  </div>
                  {/* Qdrant coverage dot */}
                  <div className="mt-1 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${qdrantOk ? "bg-emerald-500" : disk > 0 ? "bg-amber-500" : "bg-gray-700"}`} />
                    <span className="text-[9px] text-gray-700">
                      {qdrantOk ? "проіндексовано" : disk > 0 ? "є файли, потрібен реіндекс" : "немає даних"}
                    </span>
                  </div>
                </div>

                {/* Disk files */}
                <div className={`text-right text-xs font-mono w-20 ${disk > 0 ? "text-[#E0E6ED]" : "text-gray-700"}`}>
                  {disk > 0 ? disk.toLocaleString("uk-UA") : "—"}
                  <div className="text-[9px] text-gray-700">файлів</div>
                </div>

                {/* Qdrant chunks + unique laws */}
                <div className={`text-right text-xs font-mono w-20 ${qdrantOk ? "text-[#C9A84C]" : "text-gray-700"}`}>
                  {fmtNum(qdrant)}
                  <div className="text-[9px] text-gray-700">чанків</div>
                  {lawCounts[src] != null && lawCounts[src] > 0 && (
                    <div className="text-[9px] text-emerald-600">{lawCounts[src].toLocaleString("uk-UA")} законів</div>
                  )}
                </div>

                {/* Scraper status */}
                <div className="flex flex-col items-center justify-center w-20 gap-0.5">
                  <StatusDot running={!!sc?.running} canResume={!!sc?.can_resume} />
                  <StatusLabel running={!!sc?.running} canResume={!!sc?.can_resume} pauseRequested={!!sc?.pause_requested} />
                </div>

                {/* Reindex status */}
                <div className="flex flex-col items-center justify-center w-20 gap-0.5">
                  <StatusDot running={!!ri?.running} canResume={!!ri?.can_resume} />
                  <StatusLabel running={!!ri?.running} canResume={!!ri?.can_resume} pauseRequested={!!ri?.pause_requested} />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5 w-32" onClick={e => e.stopPropagation()}>
                  {/* Scraper button */}
                  {sc?.running ? (
                    <button onClick={() => stopScrape(src)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">
                      <Square className="w-2.5 h-2.5" />С
                    </button>
                  ) : sc?.can_resume ? (
                    <button onClick={() => { resumeScrape(src); setActiveLog({ src, type: "scrape" }) }}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors">
                      <SkipForward className="w-2.5 h-2.5" />С
                    </button>
                  ) : (
                    <button onClick={() => startScrape(src)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-blue-500/15 border border-blue-500/25 text-blue-400 hover:bg-blue-500/25 transition-colors"
                      title="Запустити скрапінг">
                      <Play className="w-2.5 h-2.5" />С
                    </button>
                  )}

                  {/* Reindex button */}
                  {ri?.running ? (
                    <button onClick={() => stopReindex(src)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors">
                      <Square className="w-2.5 h-2.5" />Р
                    </button>
                  ) : ri?.can_resume ? (
                    <button onClick={() => { resumeReindex(src); setActiveLog({ src, type: "reindex" }) }}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors">
                      <SkipForward className="w-2.5 h-2.5" />Р
                    </button>
                  ) : (
                    <button onClick={() => startReindex(src)}
                      disabled={!!reindxStatus[src]?.running || Object.values(reindxStatus).some(r => r.running)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Запустити реіндекс (одночасно тільки 1 джерело)">
                      <Play className="w-2.5 h-2.5" />Р
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Legend */}
          <div className="px-4 py-2.5 flex flex-wrap gap-4 text-[10px] text-gray-600">
            <span><span className="text-blue-400 font-bold">▶С</span> — Скрапінг: завантажує файли на диск</span>
            <span><span className="text-amber-400 font-bold">▶Р</span> — Реіндекс: читає файли з диску → записує чанки у Qdrant</span>
            <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle" /> amber = призупинено (є стан для відновлення)</span>
            <span>Файли на диску ≠ чанки у Qdrant: 1 файл → кілька чанків після реіндексу. &quot;Законів&quot; — унікальні документи (chunk_index=0)</span>
            <span>Реіндекс: одночасно тільки 1 джерело</span>
          </div>
        </div>

        {/* ── Log Panel ─────────────────────────────────────────────────────── */}
        {activeLog && (
          <LogPanel
            title={`${activeLog.src.toUpperCase()} — ${activeLog.type === "scrape" ? "скрапінг" : "реіндекс"}`}
            logs={getActiveLogs()}
            running={getActiveRunning()}
            canResume={getActiveCanResume()}
            onStop={activeLog.type === "scrape" ? () => stopScrape(activeLog.src) : () => stopReindex(activeLog.src)}
            onResume={activeLog.type === "scrape" ? () => resumeScrape(activeLog.src) : () => resumeReindex(activeLog.src)}
            onClose={() => setActiveLog(null)}
          />
        )}

        {/* ── Centroid Router ───────────────────────────────────────────────── */}
        <CentroidWidget needsRebuild={needsRebuild} />

        {/* ── Auto-sync ─────────────────────────────────────────────────────── */}
        <ScheduleWidget />

      </div>
    </div>
  )
}
