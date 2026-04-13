"use client"

import { useState, useEffect, useCallback } from "react"
import {
  ShieldCheck, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  Lock, FileText, Clock, TrendingUp,
  Scale, Gavel, BookOpen, Building2, Database,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// ── Types ────────────────────────────────────────────────────────────────────

type SectionHealth = "good" | "warning" | "critical" | "unknown"

type Section = {
  code: string
  label: string
  rada_total: number | null
  rada_estimated: boolean
  our_total: number
  our_restricted: number
  our_public: number
  coverage_pct: number | null
  last_scraped_at: string | null
  health: SectionHealth
}

type OtherSource = {
  id: string
  label: string
  our_total: number
  last_scraped_at: string | null
  last_sync_at: string | null
  health: SectionHealth
}

type CoverageData = {
  sections: Section[]
  other_sources: OtherSource[]
  last_sync_at: string | null
  cache_age_sec: number | null
}

type SourceTab = "rada" | "laws_ccu" | "laws_wiki" | "laws_supreme"

// ── Tab config ───────────────────────────────────────────────────────────────

const SOURCE_TABS: {
  id: SourceTab
  label: string
  shortLabel: string
  icon: React.ElementType
  description: string
  color: string
}[] = [
  {
    id: "rada",
    label: "Верховна Рада",
    shortLabel: "Рада",
    icon: Scale,
    description: "Закони та нормативні акти України з офіційного сайту Ради",
    color: "text-[#C9A84C]",
  },
  {
    id: "laws_ccu",
    label: "Конституційний суд",
    shortLabel: "КСУ",
    icon: Gavel,
    description: "Рішення та висновки Конституційного суду України",
    color: "text-violet-400",
  },
  {
    id: "laws_wiki",
    label: "Вікіпедія",
    shortLabel: "Вікі",
    icon: BookOpen,
    description: "Правові статті з україномовної Вікіпедії",
    color: "text-sky-400",
  },
  {
    id: "laws_supreme",
    label: "Верховний суд",
    shortLabel: "ВСУ",
    icon: Building2,
    description: "Рішення та постанови Верховного суду України",
    color: "text-emerald-400",
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—"
  return n.toLocaleString("uk-UA")
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "ніколи"
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  if (h < 1) return "тільки що"
  if (h < 24) return `${h} год. тому`
  if (d === 1) return "вчора"
  return `${d} дн. тому`
}

function healthConfig(h: SectionHealth) {
  switch (h) {
    case "good":     return { icon: CheckCircle2,  cls: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Добре" }
    case "warning":  return { icon: AlertTriangle, cls: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   label: "Неповне" }
    case "critical": return { icon: XCircle,       cls: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",       label: "Критично" }
    default:         return { icon: HelpCircle,    cls: "text-[#C9A84C]/50", bg: "bg-[#C9A84C]/5 border-[#C9A84C]/10", label: "Невідомо" }
  }
}

function CoverageBar({ pct, thin }: { pct: number | null; thin?: boolean }) {
  if (pct == null) return <div className={`${thin ? "h-0.5" : "h-1"} rounded-full bg-[#C9A84C]/10 w-full`} />
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className={`${thin ? "h-0.5" : "h-1"} rounded-full bg-[#C9A84C]/10 w-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ElementType; label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${accent ? `bg-${accent}/10` : "bg-[#C9A84C]/10"}`}>
        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${accent ? `text-${accent}` : "text-[#C9A84C]"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] sm:text-[11px] font-black uppercase tracking-widest text-[#C9A84C]/60 leading-tight">{label}</p>
        <p className="text-base sm:text-xl font-bold text-white mt-0.5 truncate">{value}</p>
        {sub && <p className="text-[10px] sm:text-xs text-[#E0E6ED]/50 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ── Source overview card (for non-RADA tabs) ──────────────────────────────────

function SourceDetailCard({ source, tab }: { source: OtherSource; tab: typeof SOURCE_TABS[number] }) {
  const hc = healthConfig(source.health)
  const HIcon = hc.icon
  const TabIcon = tab.icon

  return (
    <div className="rounded-3xl border border-[#C9A84C]/15 bg-[#0d1120] overflow-hidden">
      {/* Header band */}
      <div className="px-6 py-5 border-b border-[#C9A84C]/10 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-2xl bg-[#C9A84C]/8 border border-[#C9A84C]/15 flex items-center justify-center shrink-0`}>
          <TabIcon className={`w-6 h-6 ${tab.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg sm:text-xl font-serif font-bold text-white">{source.label}</h2>
          <p className="text-xs text-[#E0E6ED]/50 mt-0.5">{tab.description}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold shrink-0 ${hc.bg} ${hc.cls}`}>
          <HIcon className="w-3.5 h-3.5" /> {hc.label}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y divide-[#C9A84C]/10 sm:divide-y-0">
        <div className="px-6 py-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50">Документів у базі</p>
          <p className="text-3xl sm:text-4xl font-bold text-white mt-2 tabular-nums">{fmt(source.our_total)}</p>
          <p className="text-[11px] text-[#E0E6ED]/40 mt-1">унікальних документів</p>
        </div>
        <div className="px-6 py-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50">Останній скрапінг</p>
          <p className="text-base sm:text-lg font-bold text-white mt-2">{fmtRelative(source.last_scraped_at)}</p>
          <p className="text-[11px] text-[#E0E6ED]/40 mt-1">{fmtDate(source.last_scraped_at)}</p>
        </div>
        <div className="px-6 py-5 col-span-2 sm:col-span-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50">Остання синхронізація</p>
          <p className="text-base sm:text-lg font-bold text-white mt-2">{fmtRelative(source.last_sync_at)}</p>
          <p className="text-[11px] text-[#E0E6ED]/40 mt-1">{fmtDate(source.last_sync_at)}</p>
        </div>
      </div>

      {/* Empty state */}
      {source.our_total === 0 && (
        <div className="px-6 py-4 bg-red-500/5 border-t border-red-500/10 flex items-center gap-3">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">База порожня — запустіть синхронізацію у розділі <span className="font-semibold">Синхронізація</span></p>
        </div>
      )}
    </div>
  )
}

// ── Summary bar (shown across all tabs) ─────────────────────────────────────

function AllSourcesSummary({ data, activeTab, onTabChange }: {
  data: CoverageData
  activeTab: SourceTab
  onTabChange: (t: SourceTab) => void
}) {
  const radaSections = data.sections
  const totalRadaOurs  = radaSections.reduce((s, r) => s + r.our_total, 0)
  const avgCoverage    = radaSections.filter(s => s.coverage_pct != null).length
    ? Math.round(radaSections.filter(s => s.coverage_pct != null).reduce((s, r) => s + (r.coverage_pct ?? 0), 0) / radaSections.filter(s => s.coverage_pct != null).length)
    : null

  const sourceMap = Object.fromEntries(data.other_sources.map(s => [s.id, s]))

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {SOURCE_TABS.map(tab => {
        const isRada   = tab.id === "rada"
        const count    = isRada ? totalRadaOurs : (sourceMap[tab.id]?.our_total ?? 0)
        const health   = isRada
          ? (avgCoverage != null ? (avgCoverage >= 80 ? "good" : avgCoverage >= 40 ? "warning" : "critical") : "unknown") as SectionHealth
          : (sourceMap[tab.id]?.health ?? "unknown") as SectionHealth
        const hc       = healthConfig(health)
        const HIcon    = hc.icon
        const TabIcon  = tab.icon
        const isActive = activeTab === tab.id

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`text-left rounded-2xl border p-4 transition-all ${
              isActive
                ? "border-[#C9A84C]/40 bg-[#C9A84C]/8 shadow-lg shadow-[#C9A84C]/5"
                : "border-[#C9A84C]/10 bg-[#0d1120]/60 hover:border-[#C9A84C]/25 hover:bg-[#0d1120]"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isActive ? "bg-[#C9A84C]/15" : "bg-[#C9A84C]/8"}`}>
                <TabIcon className={`w-4 h-4 ${isActive ? tab.color : "text-[#C9A84C]/60"}`} />
              </div>
              <span className={`flex items-center gap-1 text-[10px] font-bold ${hc.cls}`}>
                <HIcon className="w-3 h-3" />
                <span className="hidden sm:inline">{hc.label}</span>
              </span>
            </div>
            <p className={`text-lg sm:text-xl font-bold tabular-nums ${isActive ? "text-white" : "text-[#E0E6ED]/80"}`}>
              {fmt(count)}
            </p>
            <p className="text-[10px] font-semibold text-[#C9A84C]/60 mt-0.5">
              {tab.shortLabel}
              {isRada && avgCoverage != null && (
                <span className={`ml-1.5 ${hc.cls}`}>{avgCoverage}%</span>
              )}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ── RADA Tab ─────────────────────────────────────────────────────────────────

function RadaTab({ data }: { data: CoverageData }) {
  const [filter, setFilter] = useState<SectionHealth | "all">("all")
  const sections = data.sections
  const visible  = filter === "all" ? sections : sections.filter(s => s.health === filter)

  const totalRada  = sections.reduce((s, r) => s + (r.rada_total ?? 0), 0)
  const totalOurs  = sections.reduce((s, r) => s + r.our_total, 0)
  const totalRestr = sections.reduce((s, r) => s + r.our_restricted, 0)
  const avgCov     = sections.filter(s => s.coverage_pct != null).length
    ? Math.round(sections.filter(s => s.coverage_pct != null).reduce((s, r) => s + (r.coverage_pct ?? 0), 0) / sections.filter(s => s.coverage_pct != null).length)
    : null
  const goodCount  = sections.filter(s => s.health === "good").length
  const warnCount  = sections.filter(s => s.health === "warning").length
  const critCount  = sections.filter(s => s.health === "critical").length

  const FILTERS: { key: SectionHealth | "all"; label: string; count?: number }[] = [
    { key: "all",      label: "Всі",      count: sections.length },
    { key: "good",     label: "Добре",    count: goodCount },
    { key: "warning",  label: "Неповне",  count: warnCount },
    { key: "critical", label: "Критично", count: critCount },
  ]

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
        <StatCard icon={TrendingUp} label="Середнє покриття"     value={avgCov != null ? `${avgCov}%` : "—"} />
        <StatCard icon={FileText}   label="Документів у нас"     value={fmt(totalOurs)} sub={`з ~${fmt(totalRada)} на Раді`} />
        <StatCard icon={Lock}       label="ДСК зафіксовано"      value={fmt(totalRestr)} sub="службового використання" />
        <StatCard icon={Clock}      label="Остання синхронізація" value={fmtRelative(data.last_sync_at)} sub={fmtDate(data.last_sync_at)} />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none pb-0.5">
        {FILTERS.map(f => {
          const hc = f.key !== "all" ? healthConfig(f.key) : null
          const isActive = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-8 px-3 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 shrink-0 ${
                isActive
                  ? "bg-[#C9A84C]/15 border-[#C9A84C]/40 text-[#C9A84C]"
                  : "border-[#C9A84C]/15 text-[#E0E6ED]/60 hover:border-[#C9A84C]/30 hover:text-[#E0E6ED]"
              }`}
            >
              {hc && <hc.icon className={`w-3 h-3 ${isActive ? hc.cls : ""}`} />}
              {f.label}
              {f.count != null && (
                <span className={`${isActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/40"}`}>({f.count})</span>
              )}
            </button>
          )
        })}
        <span className="ml-auto text-[10px] text-[#C9A84C]/30 font-medium hidden sm:block whitespace-nowrap">
          Дані кешуються 24 год. · натисніть «Оновити з Ради» для свіжих даних
        </span>
      </div>

      {/* MOBILE cards */}
      <div className="sm:hidden rounded-2xl border border-[#C9A84C]/15 overflow-hidden divide-y divide-[#C9A84C]/8">
        {visible.map((s) => {
          const hc = healthConfig(s.health)
          const HIcon = hc.icon
          return (
            <div key={s.code} className="px-4 py-3 flex items-center gap-3">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 ${hc.bg}`}>
                <HIcon className={`w-4 h-4 ${hc.cls}`} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#E0E6ED] truncate">{s.label}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-[#C9A84C]/40">{s.code}</span>
                  <div className="flex-1"><CoverageBar pct={s.coverage_pct} /></div>
                </div>
                <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">
                  У нас: <span className="text-[#E0E6ED]/70 font-semibold">{fmt(s.our_total)}</span>
                  {s.rada_total != null && <> / Рада: {s.rada_estimated ? "~" : ""}{fmt(s.rada_total)}</>}
                  {s.our_restricted > 0 && <> · <Lock className="w-2.5 h-2.5 text-amber-400 inline" /> {s.our_restricted}</>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-lg font-bold tabular-nums ${
                  s.coverage_pct == null ? "text-[#C9A84C]/40"
                    : s.coverage_pct >= 80 ? "text-emerald-400"
                    : s.coverage_pct >= 40 ? "text-amber-400"
                    : "text-red-400"
                }`}>
                  {s.coverage_pct != null ? `${s.coverage_pct}%` : "—"}
                </p>
                <p className="text-[10px] text-[#E0E6ED]/40">{fmtRelative(s.last_scraped_at)}</p>
              </div>
            </div>
          )
        })}
        {visible.length === 0 && (
          <div className="py-10 text-center text-[#E0E6ED]/40 text-sm">Немає розділів з таким статусом</div>
        )}
      </div>

      {/* DESKTOP table */}
      <div className="hidden sm:block rounded-2xl border border-[#C9A84C]/15 overflow-hidden">
        <div className="grid grid-cols-[1fr_repeat(4,auto)_auto] gap-4 px-5 py-2.5 bg-[#C9A84C]/5 border-b border-[#C9A84C]/10 text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50">
          <span>Розділ</span>
          <span className="text-right w-20">На Раді</span>
          <span className="text-right w-16">У нас</span>
          <span className="text-right w-14">ДСК</span>
          <span className="text-right w-20">Покриття</span>
          <span className="text-right w-24">Оновлено</span>
        </div>
        <div className="divide-y divide-[#C9A84C]/8">
          {visible.map((s) => {
            const hc = healthConfig(s.health)
            const HIcon = hc.icon
            return (
              <div key={s.code} className="grid grid-cols-[1fr_repeat(4,auto)_auto] gap-4 px-5 py-3.5 hover:bg-[#C9A84C]/3 transition-colors items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border shrink-0 ${hc.bg}`}>
                    <HIcon className={`w-3.5 h-3.5 ${hc.cls}`} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#E0E6ED] truncate">{s.label}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-[#C9A84C]/40">{s.code}</span>
                      <CoverageBar pct={s.coverage_pct} />
                    </div>
                  </div>
                </div>
                <span className="text-right w-20 text-sm font-mono text-[#E0E6ED]/70">
                  {s.rada_total != null ? `${s.rada_estimated ? "~" : ""}${fmt(s.rada_total)}` : "—"}
                </span>
                <span className="text-right w-16 text-sm font-mono font-semibold text-[#E0E6ED]">
                  {fmt(s.our_total)}
                </span>
                <span className={`text-right w-14 text-sm font-mono ${s.our_restricted > 0 ? "text-amber-400" : "text-[#E0E6ED]/30"}`}>
                  {s.our_restricted > 0 ? (
                    <span className="flex items-center justify-end gap-1">
                      <Lock className="w-3 h-3" />{s.our_restricted}
                    </span>
                  ) : "—"}
                </span>
                <span className={`text-right w-20 text-sm font-bold ${
                  s.coverage_pct == null ? "text-[#C9A84C]/40"
                    : s.coverage_pct >= 80 ? "text-emerald-400"
                    : s.coverage_pct >= 40 ? "text-amber-400"
                    : "text-red-400"
                }`}>
                  {s.coverage_pct != null ? `${s.coverage_pct}%` : "—"}
                </span>
                <span className="text-right w-24 text-xs text-[#E0E6ED]/40">
                  {fmtRelative(s.last_scraped_at)}
                </span>
              </div>
            )
          })}
          {visible.length === 0 && (
            <div className="py-12 text-center text-[#E0E6ED]/40 text-sm">Немає розділів з таким статусом</div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="hidden sm:flex flex-wrap gap-4 text-xs text-[#E0E6ED]/50">
        {(["good", "warning", "critical"] as SectionHealth[]).map(h => {
          const hc = healthConfig(h)
          const HIcon = hc.icon
          const desc = h === "good" ? "≥ 80% документів є в базі"
            : h === "warning" ? "40–79% документів є в базі"
            : "< 40% документів є в базі"
          return (
            <span key={h} className="flex items-center gap-1.5">
              <HIcon className={`w-3.5 h-3.5 ${hc.cls}`} /> {hc.label} — {desc}
            </span>
          )
        })}
        <span className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-amber-400" /> ДСК — документи службового використання
        </span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const [data, setData]           = useState<CoverageData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SourceTab>("rada")

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const url = forceRefresh ? "/api/admin/rada/coverage?refresh=true" : "/api/admin/rada/coverage"
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error(`Помилка ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка завантаження")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const activeTabCfg = SOURCE_TABS.find(t => t.id === activeTab)!
  const activeSource = data?.other_sources?.find(s => s.id === activeTab)

  return (
    <div className="flex flex-col gap-4 sm:gap-6 pb-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <Database className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Покриття бази</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">
              Стан всіх джерел знань системи
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data?.cache_age_sec != null && (
            <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/40 hidden sm:block">
              Рада: {Math.round(data.cache_age_sec / 3600)} год. тому
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="gap-1.5 h-8 sm:h-9 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs"
          >
            {(loading || refreshing) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{refreshing ? "Оновлюємо…" : "Оновити"}</span>
          </Button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
          <button className="ml-auto text-xs hover:text-red-300 transition-colors" onClick={() => load()}>Повторити</button>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-24 rounded-2xl bg-[#C9A84C]/5 animate-pulse" style={{ animationDelay: `${i*60}ms` }} />
            ))}
          </div>
          <div className="grid gap-2 sm:gap-3 mt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-2xl bg-[#C9A84C]/5 animate-pulse" style={{ animationDelay: `${i*40}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {!loading && !error && data && (
        <>
          {/* Source summary cards (act as tabs) */}
          <AllSourcesSummary data={data} activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Active tab label */}
          <div className="flex items-center gap-2 -mb-1">
            <activeTabCfg.icon className={`w-4 h-4 ${activeTabCfg.color}`} />
            <h2 className="text-sm font-bold text-[#E0E6ED]/80">{activeTabCfg.label}</h2>
            <div className="flex-1 h-px bg-[#C9A84C]/10" />
          </div>

          {/* Tab content */}
          {activeTab === "rada" ? (
            <RadaTab data={data} />
          ) : activeSource ? (
            <SourceDetailCard source={activeSource} tab={activeTabCfg} />
          ) : (
            <div className="py-12 text-center text-[#E0E6ED]/40 text-sm">Дані недоступні</div>
          )}
        </>
      )}
    </div>
  )
}
