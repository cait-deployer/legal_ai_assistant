"use client"

import useSWR from "swr"
import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  BarChart2, Clock, Brain, Users, TrendingUp,
  MessageSquare, AlertCircle, Smile, Meh, Frown,
  UserPlus, Repeat2, Target, Timer, X,
} from "lucide-react"

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  total: number
  period: number
  days: number
  avgComplexity: string | null
  avgProcessingTimeMs: number | null
  categories: [string, number][]
  sentiments: [string, number][]
  intents: [string, number][]
  topUsers: { user_id: string; count: number; email: string; full_name: string | null }[]
  dailyTrend: { date: string; count: number }[]
  recent: {
    id: string
    query_text: string
    ai_response: string | null
    category: string | null
    sentiment: string | null
    complexity_score: number | null
    processing_time_ms: number | null
    user_intent: string | null
    created_at: string
    user_id: string | null
  }[]
  newUsersTotal: number
  newUsersPerDay: { date: string; count: number }[]
  retentionRate: number
  conversionRate: number
  avgSessionMs: number | null
  totalUsers: number
  activeUsers: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  neutral:   { label: "Нейтральний", color: "#6B7CA3", icon: Meh },
  urgent:    { label: "Терміново",   color: "#F59E0B", icon: AlertCircle },
  frustrated:{ label: "Засмучений",  color: "#EF4444", icon: Frown },
  positive:  { label: "Позитивний",  color: "#10B981", icon: Smile },
}

const CATEGORY_COLORS = [
  "#C9A84C", "#8B6FBF", "#4E9FBF", "#BF4E4E", "#4EBF8F", "#BF8F4E", "#7E8FB5",
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })
}

function formatTime(ms: number | null) {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}мс`
  return `${(ms / 1000).toFixed(1)}с`
}


// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = "#C9A84C",
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-3 sm:p-5 flex gap-3 sm:gap-4 items-start"
    >
      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] sm:text-xs text-[#6B7CA3] font-medium uppercase tracking-widest mb-0.5 leading-tight">{label}</p>
        <p className="text-xl sm:text-2xl font-bold text-[#E0E6ED]">{value}</p>
        {sub && <p className="text-[10px] sm:text-xs text-[#6B7CA3] mt-0.5 truncate">{sub}</p>}
      </div>
    </motion.div>
  )
}

function CssBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-2 rounded-full bg-[#1a2035] overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="h-full rounded-full"
        style={{ background: color }}
      />
    </div>
  )
}

function DailyChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div className="flex items-end gap-2 h-24 mt-2">
      {data.map(({ date, count }) => {
        const pct = Math.round((count / max) * 100)
        return (
          <div key={date} className="flex-1 flex flex-col items-center gap-1 group">
            <span className="text-[10px] text-[#6B7CA3] opacity-0 group-hover:opacity-100 transition-opacity">
              {count}
            </span>
            <div className="w-full flex items-end" style={{ height: "72px" }}>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(pct, 4)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="w-full rounded-t-md"
                style={{ background: count > 0 ? "#C9A84C" : "#1a2035" }}
              />
            </div>
            <span className="text-[10px] text-[#6B7CA3]">{formatDate(date)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Query Modal ───────────────────────────────────────────────────────────────

type QueryRow = AnalyticsData["recent"][number]

function QueryModal({ row, onClose }: { row: QueryRow; onClose: () => void }) {
  const sentCfg = SENTIMENT_CONFIG[row.sentiment ?? ""] ?? null
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-2xl bg-[#0d1120] border border-[#C9A84C]/25 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#C9A84C]/10">
            <div className="flex items-center gap-2 flex-wrap">
              {row.category && (
                <span className="bg-[#C9A84C]/10 text-[#C9A84C] px-2 py-0.5 rounded-full text-[11px] font-medium">
                  {row.category}
                </span>
              )}
              {sentCfg && (
                <span className="flex items-center gap-1 text-xs" style={{ color: sentCfg.color }}>
                  <sentCfg.icon className="w-3 h-3" />
                  {sentCfg.label}
                </span>
              )}
              <span className="text-[11px] text-[#6B7CA3]">
                {new Date(row.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <button onClick={onClose} className="text-[#6B7CA3] hover:text-[#E0E6ED] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Question */}
            <div>
              <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-2">Запит</p>
              <div className="bg-[#C9A84C]/5 border border-[#C9A84C]/15 rounded-xl px-4 py-3 text-sm text-[#E0E6ED]/90 leading-relaxed">
                {row.query_text}
              </div>
            </div>

            {/* Answer */}
            <div>
              <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-2">Відповідь</p>
              <div className="bg-[#1a2035] border border-[#C9A84C]/10 rounded-xl px-4 py-3 text-sm text-[#E0E6ED]/75 leading-relaxed whitespace-pre-wrap">
                {row.ai_response ?? <span className="text-[#6B7CA3] italic">Відповідь не збережена</span>}
              </div>
            </div>

            {/* Meta */}
            <div className="flex gap-4 text-xs text-[#6B7CA3] pt-1">
              {row.complexity_score && (
                <span>Складність: <span className="text-[#C9A84C]">{"★".repeat(row.complexity_score)}</span></span>
              )}
              {row.processing_time_ms && (
                <span>Час: <span className="text-[#E0E6ED]/60">{formatTime(row.processing_time_ms)}</span></span>
              )}
              {row.user_intent && (
                <span>Намір: <span className="text-[#E0E6ED]/60">{row.user_intent}</span></span>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const [activeQuery, setActiveQuery] = useState<QueryRow | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const { data, isLoading } = useSWR<AnalyticsData>(
    `/api/admin/analytics?days=${days}`,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const periodTotal = data?.period ?? 0
  const catMax = data?.categories?.[0]?.[1] ?? 1

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <BarChart2 className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-serif font-bold text-[#E0E6ED]">Аналітика запитів</h1>
            <p className="text-xs sm:text-sm text-[#6B7CA3] mt-0.5 hidden sm:block">
              Всього запитів у системі: <span className="text-[#C9A84C] font-semibold">{data?.total ?? "—"}</span>
            </p>
          </div>
        </div>
        {/* Period selector */}
        <div className="flex gap-1 bg-[#0d1120] border border-[#C9A84C]/15 rounded-xl p-1 shrink-0">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                days === d
                  ? "bg-[#C9A84C] text-[#0A0E1A]"
                  : "text-[#6B7CA3] hover:text-[#E0E6ED]"
              }`}
            >
              {d}д
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-[#6B7CA3]">Завантаження…</div>
      ) : (
        <>
          {/* Stats toggle — mobile only */}
          <button
            onClick={() => setStatsOpen(o => !o)}
            className="sm:hidden flex items-center justify-between w-full px-4 py-2.5 bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl text-xs font-semibold text-[#C9A84C]/70"
          >
            <span>Статистика</span>
            <span className={`transition-transform ${statsOpen ? "rotate-180" : ""}`}>▼</span>
          </button>

          {/* Stat cards — collapsible on mobile */}
          <div className={`${statsOpen ? "flex" : "hidden"} sm:flex flex-col gap-4`}>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
              <StatCard icon={MessageSquare} label={`Запити (${days}д)`} value={periodTotal} sub={`Всього: ${data?.total ?? 0}`} />
              <StatCard icon={Clock} label="Сер. час відповіді" value={formatTime(data?.avgProcessingTimeMs ?? null)} color="#4E9FBF" />
              <StatCard icon={Brain} label="Сер. складність" value={data?.avgComplexity ?? "—"} sub="Шкала 1–5" color="#8B6FBF" />
              <StatCard icon={Users} label="Найактивніший" value={data?.topUsers?.[0]?.count ?? "—"} sub={data?.topUsers?.[0]?.full_name ?? data?.topUsers?.[0]?.email ?? "—"} color="#10B981" />
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
              <StatCard icon={UserPlus} label={`Нових (${days}д)`} value={data?.newUsersTotal ?? "—"} sub={`Всього: ${data?.totalUsers ?? 0}`} color="#4E9FBF" />
              <StatCard icon={Repeat2} label="Retention" value={data?.retentionRate != null ? `${data.retentionRate}%` : "—"} sub="Повернулись >1 разу" color="#8B6FBF" />
              <StatCard icon={Target} label="Конверсія" value={data?.conversionRate != null ? `${data.conversionRate}%` : "—"} sub={`Активних: ${data?.activeUsers ?? 0}/${data?.totalUsers ?? 0}`} color="#10B981" />
              <StatCard icon={Timer} label="Сер. сесія" value={data?.avgSessionMs ? formatTime(data.avgSessionMs) : "—"} sub="Від першого до останнього" color="#F59E0B" />
            </div>
          </div>

          {/* Daily trend + Sentiments */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Daily chart */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[#C9A84C]" />
                <h2 className="text-sm font-semibold text-[#E0E6ED]">Тренд (7 днів)</h2>
              </div>
              <DailyChart data={data?.dailyTrend ?? []} />
            </motion.div>

            {/* Sentiments */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Smile className="w-4 h-4 text-[#C9A84C]" />
                <h2 className="text-sm font-semibold text-[#E0E6ED]">Настрій запитів</h2>
              </div>
              <div className="space-y-3">
                {(data?.sentiments ?? []).map(([key, count]) => {
                  const cfg = SENTIMENT_CONFIG[key] ?? { label: key, color: "#6B7CA3", icon: Meh }
                  const Icon = cfg.icon
                  const sentMax = data?.sentiments?.reduce((a, [, c]) => a + c, 0) || 1
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <Icon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} />
                      <span className="text-xs text-[#E0E6ED]/70 w-24 shrink-0">{cfg.label}</span>
                      <div className="flex-1">
                        <CssBar value={count} max={sentMax} color={cfg.color} />
                      </div>
                      <span className="text-xs font-semibold text-[#E0E6ED] w-8 text-right">{count}</span>
                    </div>
                  )
                })}
                {(data?.sentiments?.length ?? 0) === 0 && (
                  <p className="text-xs text-[#6B7CA3] py-4 text-center">Даних поки немає</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* Categories + Intents + Top users */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Categories */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-5 xl:col-span-1"
            >
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-[#C9A84C]" />
                <h2 className="text-sm font-semibold text-[#E0E6ED]">Категорії</h2>
              </div>
              <div className="space-y-3">
                {(data?.categories ?? []).map(([cat, count], i) => (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#E0E6ED]/80 truncate pr-2">{cat}</span>
                      <span className="text-[#E0E6ED] font-semibold shrink-0">{count}</span>
                    </div>
                    <CssBar value={count} max={catMax} color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                  </div>
                ))}
                {(data?.categories?.length ?? 0) === 0 && (
                  <p className="text-xs text-[#6B7CA3] py-4 text-center">Немає даних</p>
                )}
              </div>
            </motion.div>

            {/* Intents */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-4 h-4 text-[#C9A84C]" />
                <h2 className="text-sm font-semibold text-[#E0E6ED]">Намір запиту</h2>
              </div>
              <div className="space-y-3">
                {(data?.intents ?? []).map(([intent, count], i) => {
                  const intentMax = data?.intents?.reduce((a, [, c]) => a + c, 0) || 1
                  return (
                    <div key={intent}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[#E0E6ED]/80 capitalize">{intent}</span>
                        <span className="text-[#E0E6ED] font-semibold">{count}</span>
                      </div>
                      <CssBar value={count} max={intentMax} color={CATEGORY_COLORS[(i + 3) % CATEGORY_COLORS.length]} />
                    </div>
                  )
                })}
                {(data?.intents?.length ?? 0) === 0 && (
                  <p className="text-xs text-[#6B7CA3] py-4 text-center">Немає даних</p>
                )}
              </div>
            </motion.div>

            {/* Top users */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-[#C9A84C]" />
                <h2 className="text-sm font-semibold text-[#E0E6ED]">Топ користувачів</h2>
                <span className="text-xs text-[#6B7CA3]">за {days}д</span>
              </div>
              <div className="space-y-2.5">
                {(data?.topUsers ?? []).map(({ user_id, count, email, full_name }, i) => (
                  <div key={user_id} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#C9A84C]/60 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#E0E6ED]/80 truncate">{full_name ?? email}</p>
                      {full_name && <p className="text-[11px] text-[#6B7CA3] truncate">{email}</p>}
                    </div>
                    <span className="text-xs font-bold text-[#C9A84C] bg-[#C9A84C]/10 px-2 py-0.5 rounded-full shrink-0">{count}</span>
                  </div>
                ))}
                {(data?.topUsers?.length ?? 0) === 0 && (
                  <p className="text-xs text-[#6B7CA3] py-4 text-center">Немає даних</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* Recent queries table */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#C9A84C]/10 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#C9A84C]" />
              <h2 className="text-sm font-semibold text-[#E0E6ED]">Останні запити</h2>
            </div>
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-[#C9A84C]/5">
              {(data?.recent ?? []).map((row) => {
                const sentCfg = SENTIMENT_CONFIG[row.sentiment ?? ""] ?? null
                return (
                  <div key={row.id} onClick={() => setActiveQuery(row)}
                    className="px-4 py-3 cursor-pointer hover:bg-[#C9A84C]/5 active:bg-[#C9A84C]/10 transition-colors">
                    <p className="text-sm text-[#E0E6ED]/80 line-clamp-2 mb-1">{row.query_text}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {row.category && (
                        <span className="bg-[#C9A84C]/10 text-[#C9A84C] px-2 py-0.5 rounded-full text-[10px] font-medium">{row.category}</span>
                      )}
                      {sentCfg && (
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: sentCfg.color }}>
                          <sentCfg.icon className="w-3 h-3" />{sentCfg.label}
                        </span>
                      )}
                      <span className="text-[10px] text-[#6B7CA3] ml-auto">
                        {new Date(row.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                )
              })}
              {(data?.recent?.length ?? 0) === 0 && (
                <div className="px-4 py-8 text-center text-sm text-[#6B7CA3]">Записів поки немає</div>
              )}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#C9A84C]/10">
                    {["Запит", "Категорія", "Настрій", "Складність", "Час", "Дата"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[#6B7CA3] font-semibold uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.recent ?? []).map((row) => {
                    const sentCfg = SENTIMENT_CONFIG[row.sentiment ?? ""] ?? null
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[#C9A84C]/5 hover:bg-[#C9A84C]/5 transition-colors cursor-pointer"
                        onClick={() => setActiveQuery(row)}
                      >
                        <td className="px-4 py-3 max-w-xs">
                          <span className="text-[#E0E6ED]/80 line-clamp-1">{row.query_text}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="bg-[#C9A84C]/10 text-[#C9A84C] px-2 py-0.5 rounded-full text-[11px] font-medium">
                            {row.category ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {sentCfg ? (
                            <span className="flex items-center gap-1" style={{ color: sentCfg.color }}>
                              <sentCfg.icon className="w-3 h-3" />
                              <span>{sentCfg.label}</span>
                            </span>
                          ) : (
                            <span className="text-[#6B7CA3]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.complexity_score ? (
                            <span className="font-bold" style={{
                              color: ["","#10B981","#6EE7B7","#F59E0B","#F87171","#EF4444"][row.complexity_score] ?? "#6B7CA3"
                            }}>
                              {"★".repeat(row.complexity_score)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-[#6B7CA3]">
                          {formatTime(row.processing_time_ms)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-[#6B7CA3]">
                          {new Date(row.created_at).toLocaleString("uk-UA", {
                            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
                          })}
                        </td>
                      </tr>
                    )
                  })}
                  {(data?.recent?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[#6B7CA3]">
                        Записів поки немає — запити з'являться тут після перших звернень
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </>
      )}

      {activeQuery && <QueryModal row={activeQuery} onClose={() => setActiveQuery(null)} />}
    </div>
  )
}
