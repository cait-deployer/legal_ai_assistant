"use client"

import { useState, useEffect, useCallback } from "react"
import {
  ShieldCheck, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  Lock, FileText, Clock, TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"

type SectionHealth = "good" | "warning" | "critical" | "unknown"

type Section = {
  code: string
  label: string
  rada_total: number | null
  our_total: number
  our_restricted: number
  our_public: number
  coverage_pct: number | null
  last_scraped_at: string | null
  health: SectionHealth
}

type CoverageData = {
  sections: Section[]
  last_sync_at: string | null
  cache_age_sec: number | null
}

// ── helpers ─────────────────────────────────────────────────────────────────

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
  if (d === 0) return "сьогодні"
  if (d === 1) return "вчора"
  return `${d} дн. тому`
}

function healthConfig(h: SectionHealth) {
  switch (h) {
    case "good":     return { icon: CheckCircle2,    cls: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Добре" }
    case "warning":  return { icon: AlertTriangle,   cls: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",   label: "Неповне" }
    case "critical": return { icon: XCircle,         cls: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",       label: "Критично" }
    default:         return { icon: HelpCircle,      cls: "text-[#C9A84C]/50", bg: "bg-[#C9A84C]/5 border-[#C9A84C]/10", label: "Невідомо" }
  }
}

function CoverageBar({ pct }: { pct: number | null }) {
  if (pct == null) return <div className="h-1.5 rounded-full bg-[#C9A84C]/10 w-full" />
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="h-1.5 rounded-full bg-[#C9A84C]/10 w-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string; sub?: string
}) {
  return (
    <div className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-[#C9A84C]" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-[#C9A84C]/60">{label}</p>
        <p className="text-xl font-bold text-white mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-[#E0E6ED]/50 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── main ────────────────────────────────────────────────────────────────────

export default function CoveragePage() {
  const [data, setData] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<SectionHealth | "all">("all")

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

  const sections = data?.sections ?? []
  const visible = filter === "all" ? sections : sections.filter(s => s.health === filter)

  // Summary stats
  const totalRada    = sections.reduce((s, r) => s + (r.rada_total ?? 0), 0)
  const totalOurs    = sections.reduce((s, r) => s + r.our_total, 0)
  const totalRestr   = sections.reduce((s, r) => s + r.our_restricted, 0)
  const avgCoverage  = sections.filter(s => s.coverage_pct != null).length
    ? Math.round(sections.filter(s => s.coverage_pct != null).reduce((s, r) => s + (r.coverage_pct ?? 0), 0) / sections.filter(s => s.coverage_pct != null).length)
    : null
  const goodCount    = sections.filter(s => s.health === "good").length
  const warnCount    = sections.filter(s => s.health === "warning").length
  const critCount    = sections.filter(s => s.health === "critical").length

  const FILTERS: { key: SectionHealth | "all"; label: string; count?: number }[] = [
    { key: "all",      label: "Всі",      count: sections.length },
    { key: "good",     label: "Добре",    count: goodCount },
    { key: "warning",  label: "Неповне",  count: warnCount },
    { key: "critical", label: "Критично", count: critCount },
  ]

  return (
    <div className="flex flex-col gap-6 pb-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-2xl shrink-0">
            <ShieldCheck className="w-8 h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Покриття бази</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">
              Порівняння нашої бази знань з офіційним сайтом Ради
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {data?.cache_age_sec != null && (
            <span className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/40 hidden sm:block">
              Дані Ради: {Math.round(data.cache_age_sec / 3600)} год. тому
            </span>
          )}
          <Button
            variant="ghost" size="sm"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl"
          >
            {(loading || refreshing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {refreshing ? "Оновлюємо з Ради…" : "Оновити з Ради"}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      {!loading && data && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard icon={TrendingUp}  label="Середнє покриття"  value={avgCoverage != null ? `${avgCoverage}%` : "—"} />
          <StatCard icon={FileText}    label="Документів у нас"  value={fmt(totalOurs)}   sub={`з ~${fmt(totalRada)} на Раді`} />
          <StatCard icon={Lock}        label="ДСК зафіксовано"   value={fmt(totalRestr)}  sub="для службового використання" />
          <StatCard icon={Clock}       label="Остання синхронізація" value={fmtRelative(data.last_sync_at)} sub={fmtDate(data.last_sync_at)} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
          <button className="ml-auto text-xs hover:text-red-300 transition-colors" onClick={() => load()}>Повторити</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-[#C9A84C]/5 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
          ))}
        </div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {FILTERS.map(f => {
              const hc = f.key !== "all" ? healthConfig(f.key) : null
              const isActive = filter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`h-8 px-3.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                    isActive
                      ? "bg-[#C9A84C]/15 border-[#C9A84C]/40 text-[#C9A84C]"
                      : "border-[#C9A84C]/15 text-[#E0E6ED]/60 hover:border-[#C9A84C]/30 hover:text-[#E0E6ED]"
                  }`}
                >
                  {hc && <hc.icon className={`w-3.5 h-3.5 ${isActive ? hc.cls : ""}`} />}
                  {f.label}
                  {f.count != null && (
                    <span className={`ml-0.5 ${isActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/40"}`}>({f.count})</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Note about Rada refresh */}
          <p className="text-xs text-[#C9A84C]/40 -mt-2">
            Дані з сайту Ради кешуються на 24 год. Натисніть «Оновити з Ради» щоб отримати свіжі числа.
          </p>

          {/* Sections table */}
          <div className="rounded-2xl border border-[#C9A84C]/15 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_repeat(4,auto)_auto] gap-4 px-5 py-2.5 bg-[#C9A84C]/5 border-b border-[#C9A84C]/10 text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50">
              <span>Розділ</span>
              <span className="text-right w-20">На Раді</span>
              <span className="text-right w-16">У нас</span>
              <span className="text-right w-14">ДСК</span>
              <span className="text-right w-20">Покриття</span>
              <span className="text-right w-24">Оновлено</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-[#C9A84C]/8">
              {visible.map((s) => {
                const hc = healthConfig(s.health)
                const HIcon = hc.icon
                return (
                  <div
                    key={s.code}
                    className="grid grid-cols-[1fr_repeat(4,auto)_auto] gap-4 px-5 py-3.5 hover:bg-[#C9A84C]/3 transition-colors items-center"
                  >
                    {/* Section name */}
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

                    {/* Rada total */}
                    <span className="text-right w-20 text-sm font-mono text-[#E0E6ED]/70">
                      {s.rada_total != null ? `~${fmt(s.rada_total)}` : "—"}
                    </span>

                    {/* Our total */}
                    <span className="text-right w-16 text-sm font-mono font-semibold text-[#E0E6ED]">
                      {fmt(s.our_total)}
                    </span>

                    {/* Restricted */}
                    <span className={`text-right w-14 text-sm font-mono ${s.our_restricted > 0 ? "text-amber-400" : "text-[#E0E6ED]/30"}`}>
                      {s.our_restricted > 0 ? (
                        <span className="flex items-center justify-end gap-1">
                          <Lock className="w-3 h-3" />{s.our_restricted}
                        </span>
                      ) : "—"}
                    </span>

                    {/* Coverage % */}
                    <span className={`text-right w-20 text-sm font-bold ${
                      s.coverage_pct == null ? "text-[#C9A84C]/40"
                        : s.coverage_pct >= 80 ? "text-emerald-400"
                        : s.coverage_pct >= 40 ? "text-amber-400"
                        : "text-red-400"
                    }`}>
                      {s.coverage_pct != null ? `${s.coverage_pct}%` : "—"}
                    </span>

                    {/* Last scraped */}
                    <span className="text-right w-24 text-xs text-[#E0E6ED]/40">
                      {fmtRelative(s.last_scraped_at)}
                    </span>
                  </div>
                )
              })}

              {visible.length === 0 && (
                <div className="py-12 text-center text-[#E0E6ED]/40 text-sm">
                  Немає розділів з таким статусом
                </div>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-[#E0E6ED]/50">
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
              <Lock className="w-3.5 h-3.5 text-amber-400" /> ДСК — документи службового використання (без публічного тексту)
            </span>
          </div>
        </>
      )}
    </div>
  )
}
