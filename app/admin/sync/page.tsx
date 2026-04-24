"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { RefreshCw, Download, HardDriveDownload, Cpu, RotateCcw, AlertCircle } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type SourceState = {
  running: boolean
  pause_requested: boolean
  can_resume: boolean
}

type CentroidStatus = {
  building: boolean
  ready: boolean
  built_at: string | null
  total_collections: number
  collections: Record<string, number>
}

type DiskSource = { files: number; size_mb: number }

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"] as const
type Source = typeof SOURCES[number]

const SOURCE_META: Record<Source, { label: string; expected: string; color: string }> = {
  rada:      { label: "Верховна Рада",        expected: "~15 500", color: "blue"    },
  kmu:       { label: "Кабінет Міністрів",    expected: "~10 000", color: "amber"   },
  ccu:       { label: "Конституційний суд",   expected: "~500",    color: "purple"  },
  supreme:   { label: "Верховний суд",        expected: "~1 000",  color: "emerald" },
  wiki:      { label: "Legal Aid Wiki",       expected: "~кілька тис.", color: "gray" },
  positions: { label: "Правові позиції ВС",  expected: "~12 800", color: "gold"    },
  mod:       { label: "Міністерство оборони", expected: "~210",    color: "red"     },
  zir:       { label: "ЗІР ДПС",             expected: "~5 900",  color: "teal"    },
}

const SOURCE_TO_COLS: Record<Source, string[]> = {
  rada:      ["rada_finance_v2","rada_state_v2","rada_personnel_v2","rada_court_v2","rada_intl_v2","rada_labor_v2","rada_civil_v2","rada_criminal_v2","rada_admin_v2","rada_housing_v2","rada_land_v2","rada_industry_v2","rada_other_v2"],
  kmu:       ["laws_kmu_v2"],
  ccu:       ["laws_ccu_v2"],
  supreme:   ["laws_supreme_v2"],
  wiki:      ["laws_wiki_v2"],
  positions: ["laws_positions_v2"],
  mod:       ["laws_mod_v2"],
  zir:       ["laws_zir_v2"],
}

const COLOR_CLASSES: Record<string, { border: string; badge: string; dot: string }> = {
  blue:    { border: "border-blue-500/20",    badge: "bg-blue-500/10 text-blue-300",    dot: "bg-blue-400"    },
  amber:   { border: "border-amber-500/20",   badge: "bg-amber-500/10 text-amber-300",  dot: "bg-amber-400"   },
  purple:  { border: "border-purple-500/20",  badge: "bg-purple-500/10 text-purple-300",dot: "bg-purple-400"  },
  emerald: { border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400" },
  gray:    { border: "border-gray-500/20",    badge: "bg-gray-500/10 text-gray-300",    dot: "bg-gray-400"    },
  gold:    { border: "border-[#C9A84C]/30",   badge: "bg-[#C9A84C]/10 text-[#C9A84C]", dot: "bg-[#C9A84C]"   },
  red:     { border: "border-red-500/20",     badge: "bg-red-500/10 text-red-300",      dot: "bg-red-400"     },
  teal:    { border: "border-teal-500/20",    badge: "bg-teal-500/10 text-teal-300",    dot: "bg-teal-400"    },
}

// ── Source card ────────────────────────────────────────────────────────────────

function SourceCard({
  src,
  scraperState,
  diskFiles,
  qdrantVectors,
}: {
  src: Source
  scraperState: SourceState | null
  diskFiles: number
  qdrantVectors: number
}) {
  const meta   = SOURCE_META[src]
  const colors = COLOR_CLASSES[meta.color]

  const scraperStatus = scraperState?.running
    ? (scraperState.pause_requested ? "stopping" : "running")
    : scraperState?.can_resume
    ? "paused"
    : "idle"

  const scraperBadge: Record<string, string> = {
    running:  "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
    stopping: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
    paused:   "bg-blue-500/20 text-blue-300 border border-blue-500/30",
    idle:     "bg-gray-500/20 text-gray-400 border border-gray-500/20",
  }

  const scraperLabel: Record<string, string> = {
    running:  "Виконується",
    stopping: "Зупиняється",
    paused:   "Призупинено",
    idle:     "Очікування",
  }

  const qdrantOk = qdrantVectors > 0
  const diskOk   = diskFiles > 0

  return (
    <div className={`bg-[#111827] rounded-2xl border ${colors.border} p-4 space-y-3 flex flex-col`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${scraperState?.running ? `${colors.dot} animate-pulse` : colors.dot} opacity-60`} />
            <span className="text-xs font-mono text-gray-500">{src}</span>
          </div>
          <div className="font-bold text-sm text-[#E0E6ED] mt-0.5">{meta.label}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">Очікується: {meta.expected}</div>
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${scraperBadge[scraperStatus]}`}>
          {scraperLabel[scraperStatus]}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-xl p-2.5 text-center ${diskOk ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-red-500/5 border border-red-500/10"}`}>
          <div className={`text-lg font-black ${diskOk ? "text-emerald-400" : "text-red-400"}`}>
            {diskFiles > 0 ? diskFiles.toLocaleString() : "0"}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">файлів на диску</div>
        </div>
        <div className={`rounded-xl p-2.5 text-center ${qdrantOk ? "bg-[#C9A84C]/5 border border-[#C9A84C]/10" : "bg-gray-500/5 border border-gray-500/10"}`}>
          <div className={`text-lg font-black ${qdrantOk ? "text-[#C9A84C]" : "text-gray-600"}`}>
            {qdrantVectors > 0 ? qdrantVectors.toLocaleString() : "—"}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">векторів Qdrant</div>
        </div>
      </div>

      {/* Status bar */}
      {diskOk && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-gray-600">
            <span>Індексація</span>
            <span className={qdrantOk ? "text-emerald-400" : "text-red-400"}>
              {qdrantOk ? "є дані" : "порожньо"}
            </span>
          </div>
          <div className="h-1 bg-[#C9A84C]/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${qdrantOk ? "bg-[#C9A84C]" : "bg-red-500/40"}`}
              style={{ width: qdrantOk ? "100%" : "0%" }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <Link href="/admin/scraper" className="flex-1">
          <button className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-[#E0E6ED] text-[11px] font-medium hover:border-[#C9A84C]/30 hover:bg-[#1e293b] transition-colors">
            <Download className="w-3 h-3" /> Скрапер
          </button>
        </Link>
        <Link href="/admin/reindex" className="flex-1">
          <button className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-[#E0E6ED] text-[11px] font-medium hover:border-[#C9A84C]/30 hover:bg-[#1e293b] transition-colors">
            <HardDriveDownload className="w-3 h-3" /> Реіндекс
          </button>
        </Link>
      </div>
    </div>
  )
}

// ── Centroid widget ────────────────────────────────────────────────────────────

function CentroidWidget() {
  const [status, setStatus]     = useState<CentroidStatus | null>(null)
  const [loading, setLoading]   = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError]       = useState("")

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
      else await fetchStatus()
    } catch { setError("Помилка з'єднання") }
    setRebuilding(false)
  }

  const isReady    = status?.ready && !status?.building
  const isBuilding = status?.building

  return (
    <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left: icon + info */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center shrink-0">
            <Cpu className="w-5 h-5 text-[#C9A84C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#E0E6ED]">Centroid Router</span>
              {isBuilding && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Будується
                </span>
              )}
              {isReady && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Активний
                </span>
              )}
              {!status && (
                <span className="text-[10px] text-gray-600">Завантаження...</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Семантичний routing на основі реальних векторів Qdrant
              {status && (
                <span className="ml-2 text-gray-600">
                  · {status.total_collections} колекцій
                  {status.built_at && ` · ${new Date(status.built_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            className="p-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/15 text-gray-400 hover:text-[#E0E6ED] hover:border-[#C9A84C]/30 transition-colors"
            title="Оновити статус"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRebuild}
            disabled={rebuilding || isBuilding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A84C]/10 border border-[#C9A84C]/25 text-[#C9A84C] text-xs font-bold hover:bg-[#C9A84C]/20 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {rebuilding ? "Запуск..." : "Перебудувати"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SyncOverviewPage() {
  const [scraperStatus, setScraperStatus] = useState<Record<string, SourceState>>({})
  const [diskData, setDiskData]           = useState<Record<string, DiskSource>>({})
  const [qdrantCounts, setQdrantCounts]   = useState<Record<string, number>>({})
  const [refreshing, setRefreshing]       = useState(false)
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null)

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const [scrapeRes, diskRes, analyticsRes] = await Promise.allSettled([
        fetch("/api/admin/v2/scrape/status"),
        fetch("/api/admin/v2/disk"),
        fetch("/api/admin/v2/analytics?limit=1"),
      ])
      if (scrapeRes.status === "fulfilled" && scrapeRes.value.ok) {
        setScraperStatus(await scrapeRes.value.json())
      }
      if (diskRes.status === "fulfilled" && diskRes.value.ok) {
        const d = await diskRes.value.json()
        setDiskData(d.sources ?? {})
      }
      if (analyticsRes.status === "fulfilled" && analyticsRes.value.ok) {
        const d = await analyticsRes.value.json()
        setQdrantCounts(d.qdrant_v2 ?? {})
      }
      setLastRefresh(new Date())
    } catch { /* ignore */ }
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function getQdrantForSource(src: Source): number {
    const cols = SOURCE_TO_COLS[src]
    return cols.reduce((sum, col) => {
      const v = qdrantCounts[col]
      return sum + (typeof v === "number" && v > 0 ? v : 0)
    }, 0)
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Зведення</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Стан всіх 8 джерел бази знань
              {lastRefresh && (
                <span className="ml-2 text-gray-600">
                  · оновлено {lastRefresh.toLocaleTimeString("uk-UA")}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#111827] border border-[#C9A84C]/15 text-[#E0E6ED] text-sm hover:border-[#C9A84C]/30 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Оновити
          </button>
        </div>

        {/* Pipeline steps */}
        <div className="flex items-center gap-2 bg-[#0d1120] rounded-xl border border-[#C9A84C]/10 px-4 py-3 overflow-x-auto">
          {[
            { step: "1", label: "Скрапер", desc: "текст → диск", href: "/admin/scraper", color: "text-blue-400" },
            { step: "→", label: "", desc: "", href: null, color: "text-gray-700" },
            { step: "2", label: "Реіндекс", desc: "диск → Qdrant v2", href: "/admin/reindex", color: "text-amber-400" },
            { step: "→", label: "", desc: "", href: null, color: "text-gray-700" },
            { step: "3", label: "Покриття", desc: "перевірка", href: "/admin/rada/coverage", color: "text-emerald-400" },
          ].map(({ step, label, desc, href, color }, i) =>
            href ? (
              <Link key={i} href={href} className="flex items-center gap-2 shrink-0 group">
                <span className={`text-xs font-black ${color}`}>{step}</span>
                <div>
                  <div className={`text-xs font-bold ${color} group-hover:underline`}>{label}</div>
                  <div className="text-[10px] text-gray-600">{desc}</div>
                </div>
              </Link>
            ) : (
              <span key={i} className={`text-sm font-bold ${color} shrink-0`}>{step}</span>
            )
          )}
        </div>

        {/* Source cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SOURCES.map(src => (
            <SourceCard
              key={src}
              src={src}
              scraperState={scraperStatus[src] ?? null}
              diskFiles={diskData[src]?.files ?? 0}
              qdrantVectors={getQdrantForSource(src)}
            />
          ))}
        </div>

        {/* Centroid Router */}
        <CentroidWidget />
      </div>
    </div>
  )
}
