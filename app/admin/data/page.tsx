"use client"

import { useState, useEffect, useRef, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type AnalyticsSummary = { total: number; ok: number; empty: number; restricted: number; error: number }
type AnalyticsBySource = Record<string, { ok: number; empty: number; restricted: number; error: number }>
type AnalyticsLaw = { law_id: string; source: string; status: string; title?: string; reason?: string; scraped_at?: string }
type AnalyticsState = {
  summary: AnalyticsSummary
  by_source: AnalyticsBySource
  qdrant_v2: Record<string, number>
  laws: AnalyticsLaw[]
  total_filtered: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]

const STATUS_BADGE: Record<string, string> = {
  ok:         "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  empty:      "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  restricted: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  error:      "bg-red-500/20 text-red-300 border border-red-500/30",
  skipped:    "bg-gray-500/20 text-gray-300 border border-gray-500/30",
}

const STATUS_FILTER_MAP: Record<string, string> = {
  "Всього": "", "OK": "ok", "Порожній": "empty", "Обмежено": "restricted", "Помилка": "error",
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DataAnalyticsPage() {
  const [data, setData]             = useState<AnalyticsState | null>(null)
  const [loading, setLoading]       = useState(false)
  const [filterStatus, setFilterStatus] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [offset, setOffset]         = useState(0)
  const [qdrantOpen, setQdrantOpen] = useState(false)
  const [colStats, setColStats]     = useState<{ total: number; collections: Record<string, number> } | null>(null)
  const [colOpen, setColOpen]       = useState(true)
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
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCardClick(label: string) {
    const st = STATUS_FILTER_MAP[label] ?? ""
    setFilterStatus(st)
    setOffset(0)
    fetchData(0, st, filterSource)
    setTimeout(() => lawsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150)
  }

  function handleFilter() { setOffset(0); fetchData(0, filterStatus, filterSource) }
  function handlePrev()   { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchData(o, filterStatus, filterSource) }
  function handleNext()   { const o = offset + PAGE_SIZE; setOffset(o); fetchData(o, filterStatus, filterSource) }

  const summary      = data?.summary
  const bySource     = data?.by_source ?? {}
  const qdrantV2     = data?.qdrant_v2 ?? {}
  const laws         = data?.laws ?? []
  const totalFiltered = data?.total_filtered ?? 0

  const summaryCards = [
    { label: "Всього",   value: summary?.total      ?? 0, color: "text-[#C9A84C]",   ring: "ring-[#C9A84C]/50",   filterVal: "" },
    { label: "OK",       value: summary?.ok         ?? 0, color: "text-emerald-400", ring: "ring-emerald-400/50", filterVal: "ok" },
    { label: "Порожній", value: summary?.empty      ?? 0, color: "text-amber-400",   ring: "ring-amber-400/50",   filterVal: "empty" },
    { label: "Обмежено", value: summary?.restricted ?? 0, color: "text-blue-400",    ring: "ring-blue-400/50",    filterVal: "restricted" },
    { label: "Помилка",  value: summary?.error      ?? 0, color: "text-red-400",     ring: "ring-red-400/50",     filterVal: "error" },
  ]

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Аналітика даних</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Статус скрапінгу і кількість векторів у Qdrant v2</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
          {summaryCards.map(card => {
            const active = filterStatus === card.filterVal
            return (
              <button key={card.label} onClick={() => handleCardClick(card.label)}
                className={`bg-[#111827] rounded-2xl border p-3 sm:p-4 text-center transition-all hover:scale-[1.03] active:scale-[0.98] cursor-pointer ${
                  active ? `border-[#C9A84C]/40 ring-2 ${card.ring}` : "border-[#C9A84C]/10 hover:border-[#C9A84C]/30"
                }`}>
                <div className={`text-2xl sm:text-3xl font-black ${card.color}`}>{card.value.toLocaleString()}</div>
                <div className="text-[10px] sm:text-xs text-gray-500 mt-1 uppercase tracking-wider">{card.label}</div>
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
                  <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
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

        {/* Qdrant v2 collections */}
        {Object.keys(qdrantV2).length > 0 && (
          <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 overflow-hidden">
            <button onClick={() => setQdrantOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-[#C9A84C]/5 transition-colors">
              <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Qdrant v2 колекції</h3>
              <span className="text-gray-500 text-lg leading-none">{qdrantOpen ? "▲" : "▼"}</span>
            </button>
            {qdrantOpen && (
              <div className="px-4 sm:px-6 pb-4 overflow-x-auto">
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
            )}
          </div>
        )}

        {/* Rada disk breakdown */}
        {colStats && (
          <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 overflow-hidden">
            <button onClick={() => setColOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 sm:px-6 py-4 hover:bg-[#C9A84C]/5 transition-colors">
              <div>
                <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider text-left">Рада — файли по колекціях</h3>
                <p className="text-xs text-gray-500 mt-0.5 text-left">Всього на диску: {colStats.total.toLocaleString()} файлів</p>
              </div>
              <span className="text-gray-500 text-lg leading-none">{colOpen ? "▲" : "▼"}</span>
            </button>
            {colOpen && (
              <div className="px-4 sm:px-6 pb-4 space-y-2">
                {Object.entries(colStats.collections).map(([col, count]) => {
                  const max     = Math.max(...Object.values(colStats.collections))
                  const pct     = max > 0 ? Math.round((count / max) * 100) : 0
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
                        <div className={`h-full rounded-full transition-all ${isEmpty ? "bg-red-500/50" : "bg-[#C9A84C]"}`}
                          style={{ width: `${Math.max(pct, isEmpty ? 2 : 0)}%` }} />
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
              {filterStatus && <span className="ml-2 text-xs font-normal normal-case tracking-normal text-gray-400">· {filterStatus}</span>}
            </h3>
            {filterStatus && (
              <button onClick={() => { setFilterStatus(""); setOffset(0); fetchData(0, "", filterSource) }}
                className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors">
                скинути фільтр
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Статус</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]">
                <option value="">Усі</option>
                <option value="ok">ok</option>
                <option value="empty">empty</option>
                <option value="restricted">restricted</option>
                <option value="error">error</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Джерело</label>
              <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
                className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]">
                <option value="">Усі</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={handleFilter} disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors">
              {loading ? "Завантаження..." : "Завантажити"}
            </button>
            <button onClick={() => fetchData(0, filterStatus, filterSource)} disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors">
              Оновити
            </button>
          </div>

          {laws.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
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
                        <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-400 max-w-[100px] sm:max-w-[140px] truncate">{law.law_id}</td>
                        <td className="py-1.5 pr-3 hidden sm:table-cell">{law.source}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE[law.status] ?? STATUS_BADGE.error}`}>
                            {law.status}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 max-w-[140px] sm:max-w-[260px] truncate text-gray-300">{law.title || "—"}</td>
                        <td className="py-1.5 max-w-[140px] truncate text-gray-500 hidden sm:table-cell">{law.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
                <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, totalFiltered)} з {totalFiltered}</span>
                <div className="flex gap-2">
                  <button onClick={handlePrev} disabled={offset === 0 || loading}
                    className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors">← Назад</button>
                  <button onClick={handleNext} disabled={offset + PAGE_SIZE >= totalFiltered || loading}
                    className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors">Вперед →</button>
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
    </div>
  )
}
