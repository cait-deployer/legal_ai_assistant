"use client"

import useSWR from "swr"
import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  BarChart2, Clock, Brain, Users, TrendingUp,
  MessageSquare, AlertCircle, Smile, Meh, Frown,
  UserPlus, Repeat2, Target, Timer, X,
  Sparkles, CheckCircle2, ShieldCheck, XCircle,
  PlayCircle, StopCircle, ChevronDown, ChevronRight,
  CheckCircle, XCircle as XCircleIcon, AlertTriangle,
  Copy,
} from "lucide-react"

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  total: number
  period: number
  days: number
  queriesPage: number
  queriesPerPage: number
  queriesTotal: number
  queriesSortBy: QuerySortBy
  queriesSortDir: SortDir
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
    query_rewritten?: string | null
    ai_response: string | null
    category: string | null
    sentiment: string | null
    complexity_score: number | null
    processing_time_ms: number | null
    user_intent: string | null
    created_at: string
    user_id: string | null
    chat_id?: string | null
    message_id?: string | null
    ai_eval?: RagEvalDraft | null
    rag_eval_case?: RagEvalCase | null
  }[]
  newUsersTotal: number
  newUsersPerDay: { date: string; count: number }[]
  retentionRate: number
  conversionRate: number
  avgSessionMs: number | null
  totalUsers: number
  activeUsers: number
}

type RagEvalSource = {
  num?: number
  title?: string | null
  law_id?: string | null
  collection?: string | null
  reason?: string | null
}

type RagEvalDraft = {
  expected_answer_type?: string
  has_direct_answer?: boolean | null
  expected_sources?: RagEvalSource[]
  bad_sources?: RagEvalSource[]
  eval_confidence?: number | null
  eval_notes?: string | null
  eval_status?: string | null
}

type RagEvalCase = {
  id?: string
  query_analytics_id?: string
  answer_type?: string
  expected_answer_type?: string
  has_direct_answer?: boolean | null
  expected_sources?: RagEvalSource[]
  bad_sources?: RagEvalSource[]
  eval_confidence?: number | null
  eval_notes?: string | null
  status?: string | null
  eval_status?: string | null
  is_gold?: boolean
  reviewed_at?: string | null
}

type SortDir = "asc" | "desc"
type QuerySortBy =
  | "created_at"
  | "processing_time_ms"
  | "complexity_score"
  | "category"
  | "sentiment"
  | "user_intent"
  | "eval_status"

// ── Eval Runner Types ─────────────────────────────────────────────────────────

type EvalSource = { law_id?: string | null; title?: string | null; found_in_top?: boolean; rank?: number | null; reason?: string | null }
type EvalLogEntry = {
  index: number; total: number; case_id: string; is_gold: boolean
  question: string; status: "running" | "done" | "error"
  hit5: boolean | null; hit10: boolean | null; bad5: boolean | null
  expected_checked: EvalSource[]; bad_checked: EvalSource[]
  top5: { law_id: string; title: string; collection: string; score: number }[]
  error: string | null
}
type EvalReport = {
  total: number; with_expected: number
  hit5: number; hit10: number; missed: number; bad5_cases: number
  hit5_rate: number | null; hit10_rate: number | null; bad5_rate: number | null
  finished_at: string
}
type EvalState = {
  running: boolean; session_id: string | null; started_at: string | null
  logs: EvalLogEntry[]; report: EvalReport | null; error: string | null
}

// ── Eval Runner Component ─────────────────────────────────────────────────────

function EvalRunner() {
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [expandedCase, setExpandedCase] = useState<string | null>(null)
  const { data: state, mutate } = useSWR<EvalState>(
    "/api/admin/eval/status",
    fetcher,
    { refreshInterval: (s: EvalState | undefined) => s?.running ? 1500 : 0 },
  )

  async function start() {
    setStarting(true)
    try {
      const res = await fetch("/api/admin/eval/run", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? "Помилка запуску"); return }
      mutate()
      setOpen(true)
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    await fetch("/api/admin/eval/run", { method: "DELETE" })
    mutate()
  }

  const logs = state?.logs ?? []
  const report = state?.report
  const running = state?.running ?? false
  const done = logs.length > 0 && !running

  function pct(n: number | null | undefined, d: number | null | undefined) {
    if (n == null || !d) return "—"
    return `${Math.round((n / d) * 100)}%`
  }

  return (
    <div className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-semibold text-[#E0E6ED] hover:text-[#C9A84C] transition-colors"
        >
          {open ? <ChevronDown className="w-4 h-4 text-[#C9A84C]" /> : <ChevronRight className="w-4 h-4 text-[#6B7CA3]" />}
          <BarChart2 className="w-4 h-4 text-[#C9A84C]" />
          Eval Runner
          {running && <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 animate-pulse">запущено</span>}
          {done && report && (
            <span className="text-[11px] text-[#6B7CA3]">
              hit@10: {pct(report.hit10, report.with_expected)} · bad@5: {pct(report.bad5_cases, report.total)}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {state?.started_at && (
            <span className="text-[11px] text-[#6B7CA3] hidden sm:block">
              {new Date(state.started_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {running ? (
            <button onClick={stop} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 text-xs font-semibold">
              <StopCircle className="w-3.5 h-3.5" /> Зупинити
            </button>
          ) : (
            <button onClick={start} disabled={starting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] text-xs font-bold disabled:opacity-60">
              <PlayCircle className="w-3.5 h-3.5" />
              {starting ? "Завантаження..." : "Запустити"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-[#C9A84C]/10 px-5 py-4 space-y-4">
          {/* Explanation */}
          <div className="bg-[#0A0E1A] border border-[#C9A84C]/10 rounded-xl px-4 py-3 text-xs text-[#6B7CA3] space-y-1">
            <p><span className="text-[#E0E6ED]">Що робить:</span> бере всі approved/gold кейси → для кожного запускає реальний RAG retrieval → перевіряє чи expected sources потрапили в top-5 і top-10 → показує де система помиляється.</p>
            <p><span className="text-[#C9A84C]">hit@5</span> — expected source в перших 5 результатах · <span className="text-[#C9A84C]">hit@10</span> — в перших 10 · <span className="text-red-300">bad@5</span> — поганий source потрапив у top-5</p>
          </div>

          {/* Summary report */}
          {report && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "hit@5", value: `${report.hit5}/${report.with_expected}`, sub: pct(report.hit5, report.with_expected), color: "#10B981" },
                { label: "hit@10", value: `${report.hit10}/${report.with_expected}`, sub: pct(report.hit10, report.with_expected), color: "#C9A84C" },
                { label: "missed", value: String(report.missed), sub: "не знайшов взагалі", color: "#EF4444" },
                { label: "bad@5", value: `${report.bad5_cases}/${report.total}`, sub: pct(report.bad5_cases, report.total), color: "#F59E0B" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-[#0A0E1A] border border-[#C9A84C]/10 rounded-xl p-3">
                  <p className="text-[10px] text-[#6B7CA3] uppercase tracking-widest">{label}</p>
                  <p className="text-xl font-bold mt-0.5" style={{ color }}>{value}</p>
                  <p className="text-[11px] text-[#6B7CA3] mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          )}

          {state?.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-300">{state.error}</div>
          )}

          {/* Progress */}
          {running && logs.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-[#6B7CA3]">
              <div className="flex-1 h-1.5 bg-[#1a2035] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#C9A84C] rounded-full transition-all"
                  style={{ width: `${Math.round((logs.length / (logs[logs.length - 1]?.total || 1)) * 100)}%` }}
                />
              </div>
              <span>{logs.length} / {logs[logs.length - 1]?.total ?? "?"}</span>
            </div>
          )}

          {/* Case logs — collapsible, no auto-scroll */}
          {logs.length > 0 && (
            <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
              {logs.map((entry) => {
                const isExpanded = expandedCase === entry.case_id
                const statusIcon = entry.status === "running"
                  ? <span className="w-3 h-3 rounded-full bg-[#C9A84C] animate-pulse inline-block" />
                  : entry.status === "error"
                    ? <XCircleIcon className="w-3.5 h-3.5 text-red-400" />
                    : entry.hit10 === false
                      ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      : <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />

                return (
                  <div key={entry.case_id} className="border border-[#C9A84C]/10 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedCase(isExpanded ? null : entry.case_id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#C9A84C]/5 transition-colors text-left"
                    >
                      <span className="shrink-0">{statusIcon}</span>
                      {entry.is_gold && <span className="text-[10px] text-[#C9A84C] bg-[#C9A84C]/10 rounded-full px-1.5 py-0.5 shrink-0">gold</span>}
                      <span className="text-xs text-[#E0E6ED]/80 flex-1 truncate">{entry.question}</span>
                      <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                        {entry.hit5 != null && <span className={entry.hit5 ? "text-emerald-400" : "text-red-400"}>h@5:{entry.hit5 ? "✓" : "✗"}</span>}
                        {entry.hit10 != null && <span className={entry.hit10 ? "text-emerald-400" : "text-amber-400"}>h@10:{entry.hit10 ? "✓" : "✗"}</span>}
                        {entry.bad5 != null && entry.bad5 && <span className="text-amber-400">bad@5:!</span>}
                      </div>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[#6B7CA3] shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-[#6B7CA3] shrink-0" />}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-[#C9A84C]/5 space-y-3">
                        {entry.error && <p className="text-xs text-red-300">{entry.error}</p>}

                        {entry.expected_checked.length > 0 && (
                          <div>
                            <p className="text-[10px] text-[#6B7CA3] uppercase tracking-wider mb-1">Expected sources</p>
                            <div className="space-y-1">
                              {entry.expected_checked.map((s, i) => (
                                <div key={i} className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg ${s.found_in_top ? "bg-emerald-500/5 border border-emerald-500/15" : "bg-red-500/5 border border-red-500/15"}`}>
                                  {s.found_in_top
                                    ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                    : <XCircleIcon className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
                                  <div>
                                    <p className="text-[#E0E6ED]/80">{s.title || s.law_id || "?"}</p>
                                    <p className="text-[#6B7CA3]">{s.found_in_top ? `rank #${s.rank}` : s.rank ? `rank #${s.rank} (поза top-5)` : "не знайдено"}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {entry.bad_checked.some(s => s.found_in_top) && (
                          <div>
                            <p className="text-[10px] text-amber-400/70 uppercase tracking-wider mb-1">Bad sources що потрапили в top-5</p>
                            <div className="space-y-1">
                              {entry.bad_checked.filter(s => s.found_in_top).map((s, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="text-[#E0E6ED]/80">{s.title || s.law_id || "?"}</p>
                                    <p className="text-amber-400/70">rank #{s.rank}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {entry.top5.length > 0 && (
                          <div>
                            <p className="text-[10px] text-[#6B7CA3] uppercase tracking-wider mb-1">Top-5 що повернув RAG</p>
                            <div className="space-y-0.5">
                              {entry.top5.map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px] text-[#6B7CA3]">
                                  <span className="text-[#C9A84C]/50 w-4">#{i + 1}</span>
                                  <span className="truncate flex-1">{r.title || r.law_id}</span>
                                  <span className="shrink-0">{r.score.toFixed(3)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!running && logs.length === 0 && (
            <p className="text-xs text-[#6B7CA3] text-center py-4">
              Натисни &ldquo;Запустити&rdquo; — система перевірить всі approved/gold кейси.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  neutral: { label: "Нейтральний", color: "#6B7CA3", icon: Meh },
  urgent: { label: "Терміново", color: "#F59E0B", icon: AlertCircle },
  frustrated: { label: "Засмучений", color: "#EF4444", icon: Frown },
  positive: { label: "Позитивний", color: "#10B981", icon: Smile },
}

const CATEGORY_COLORS = [
  "#C9A84C", "#8B6FBF", "#4E9FBF", "#BF4E4E", "#4EBF8F", "#BF8F4E", "#7E8FB5",
]

const QUERY_SORT_LABELS: Record<QuerySortBy, string> = {
  created_at: "Дата",
  processing_time_ms: "Час",
  complexity_score: "Складність",
  category: "Категорія",
  sentiment: "Настрій",
  user_intent: "Намір",
  eval_status: "Eval",
}

const QUERY_SORT_OPTIONS: QuerySortBy[] = [
  "created_at",
  "processing_time_ms",
  "complexity_score",
  "category",
  "sentiment",
  "user_intent",
  "eval_status",
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

function normalizeEvalCase(value?: RagEvalCase | RagEvalDraft | null): RagEvalCase | null {
  if (!value) return null
  return {
    ...value,
    answer_type: "answer_type" in value ? value.answer_type : value.expected_answer_type,
    status: "status" in value ? value.status : value.eval_status,
  }
}

function evalStatusLabel(row: QueryRow) {
  const evalCase = normalizeEvalCase(row.rag_eval_case ?? row.ai_eval)
  if (!evalCase) return "not evaluated"
  if (evalCase.is_gold) return "gold"
  return evalCase.status ?? "ai_draft"
}

function sourceLabel(source: RagEvalSource, index: number) {
  return source.title || source.law_id || source.collection || `source ${index + 1}`
}

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
        {sub && <p className="text-[12px] sm:text-xs text-[#6B7CA3] mt-0.5 truncate">{sub}</p>}
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
            <span className="text-[12px] text-[#6B7CA3] opacity-0 group-hover:opacity-100 transition-opacity">
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
            <span className="text-[12px] text-[#6B7CA3]">{formatDate(date)}</span>
          </div>
        )
      })}
    </div>
  )
}

function CollapsiblePanel({
  icon: Icon,
  title,
  meta,
  children,
  defaultOpen = false,
  className = "",
}: {
  icon: React.ElementType
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl overflow-hidden ${className}`}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-[#C9A84C]/5 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 text-[#C9A84C] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#6B7CA3] shrink-0" />}
          <Icon className="w-4 h-4 text-[#C9A84C] shrink-0" />
          <span className="text-sm font-semibold text-[#E0E6ED] truncate">{title}</span>
        </span>
        {meta && <span className="text-[11px] text-[#6B7CA3] shrink-0">{meta}</span>}
      </button>
      {open && (
        <div className="border-t border-[#C9A84C]/10 p-5">
          {children}
        </div>
      )}
    </motion.div>
  )
}

// ── Query Modal ───────────────────────────────────────────────────────────────

type QueryRow = AnalyticsData["recent"][number]

type AnnotatedSource = {
  num?: number; title?: string | null; law_id?: string | null
  collection?: string | null; reason?: string | null
  in_db?: boolean; db_title?: string | null; db_collection?: string | null
}
type EvalRecommendation = { action: "approve" | "reject" | "approve_gold"; is_gold: boolean; reason: string }

function stripSourceAnnotations(sources: AnnotatedSource[] | RagEvalSource[] | undefined | null) {
  return (sources ?? []).map((source) => {
    const clean = { ...source } as Record<string, unknown>
    delete clean.in_db
    delete clean.db_title
    delete clean.db_collection
    return clean
  })
}

function buildExternalAiEvalPrompt({
  row,
  evalCase,
  expectedSources,
  badSources,
  recommendation,
}: {
  row: QueryRow
  evalCase: RagEvalCase
  expectedSources: AnnotatedSource[] | RagEvalSource[]
  badSources: AnnotatedSource[] | RagEvalSource[]
  recommendation: EvalRecommendation | null
}) {
  const expected = stripSourceAnnotations(expectedSources)
  const bad = stripSourceAnnotations(badSources)
  const report = {
    answer_type: evalCase.answer_type ?? evalCase.expected_answer_type ?? null,
    has_direct_answer: evalCase.has_direct_answer ?? null,
    eval_confidence: evalCase.eval_confidence ?? null,
    status: evalCase.status ?? evalCase.eval_status ?? null,
    is_gold: evalCase.is_gold ?? false,
    eval_notes: evalCase.eval_notes ?? null,
    recommendation,
  }

  return `Ти незалежний юридичний рев'юер якості RAG для українського legal AI assistant.

Відповідай українською мовою.

Контекст:
Я перевіряю відповідь українського юридичного AI-помічника. Інша AI вже проаналізувала цей RAG-результат і підготувала чернетки масивів Expected sources та Bad sources. Твоє завдання - перевірити цей аналіз, оцінити чи відповідь підтверджується релевантними українськими юридичними джерелами, і за потреби виправити масиви джерел.

Питання користувача:
${row.query_text}

Переписаний RAG-запит:
${row.query_rewritten && row.query_rewritten !== row.query_text ? row.query_rewritten : "(same as original question)"}

Відповідь AI:
${row.ai_response ?? "(answer was not saved)"}

Попередній AI RAG eval звіт:
${JSON.stringify(report, null, 2)}

Чернетка Expected sources:
${JSON.stringify(expected, null, 2)}

Чернетка Bad sources:
${JSON.stringify(bad, null, 2)}

Твоє завдання:
1. Скажи, чи відповідь прямо відповідає на питання користувача і чи є вона юридично безпечною.
2. Перевір, чи Expected sources справді потрібні та релевантні для правильної відповіді.
3. Перевір, чи Bad sources справді нерелевантні, оманливі або шкідливі для цього питання.
4. Поверни виправлені JSON-масиви з назвами expected_sources та bad_sources.
5. Додай короткі нотатки українською: що варто approve, reject або змінити.

Формат відповіді:
- Короткий висновок.
- JSON-блок з expected_sources і bad_sources.
- Короткі нотатки щодо змін.`
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand("copy")
  document.body.removeChild(textarea)
}

function QueryModal({ row, onClose }: { row: QueryRow; onClose: () => void }) {
  const sentCfg = SENTIMENT_CONFIG[row.sentiment ?? ""] ?? null
  const [evalCase, setEvalCase] = useState<RagEvalCase | null>(() => normalizeEvalCase(row.rag_eval_case ?? row.ai_eval))
  const [evaluating, setEvaluating] = useState(false)
  const [savingEval, setSavingEval] = useState(false)
  const [copiedEvalPrompt, setCopiedEvalPrompt] = useState(false)
  const [editEval, setEditEval] = useState(false)
  const [expectedText, setExpectedText] = useState("")
  const [badText, setBadText] = useState("")
  const [notesText, setNotesText] = useState("")
  const [recommendation, setRecommendation] = useState<EvalRecommendation | null>(null)
  const [annotatedExpected, setAnnotatedExpected] = useState<AnnotatedSource[] | null>(null)
  const [annotatedBad, setAnnotatedBad] = useState<AnnotatedSource[] | null>(null)

  useEffect(() => {
    setExpectedText(JSON.stringify(evalCase?.expected_sources ?? [], null, 2))
    setBadText(JSON.stringify(evalCase?.bad_sources ?? [], null, 2))
    setNotesText(evalCase?.eval_notes ?? "")
  }, [evalCase])

  async function runAiEval() {
    setEvaluating(true)
    setRecommendation(null)
    setAnnotatedExpected(null)
    setAnnotatedBad(null)
    try {
      const res = await fetch(`/api/admin/analytics/${row.id}/evaluate`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "AI eval failed")
      setEvalCase(normalizeEvalCase(data.eval))
      if (data.recommendation) setRecommendation(data.recommendation)
      if (data.annotated_expected) {
        setAnnotatedExpected(data.annotated_expected)
        setExpectedText(JSON.stringify(stripSourceAnnotations(data.annotated_expected), null, 2))
      }
      if (data.annotated_bad) {
        setAnnotatedBad(data.annotated_bad)
        setBadText(JSON.stringify(stripSourceAnnotations(data.annotated_bad), null, 2))
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setEvaluating(false)
    }
  }

  async function patchEval(payload: Record<string, unknown>) {
    setSavingEval(true)
    try {
      const res = await fetch(`/api/admin/analytics/${row.id}/evaluate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Eval save failed")
      setEvalCase(normalizeEvalCase(data.eval))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingEval(false)
    }
  }

  function saveEvalEdits() {
    try {
      const expected_sources = JSON.parse(expectedText || "[]")
      const bad_sources = JSON.parse(badText || "[]")
      patchEval({ expected_sources, bad_sources, eval_notes: notesText, status: "human_reviewed" })
      setEditEval(false)
    } catch {
      alert("Sources JSON is not valid")
    }
  }

  async function copyExternalEvalPrompt() {
    if (!evalCase) return
    const expSources = annotatedExpected ?? evalCase.expected_sources ?? []
    const badSources = annotatedBad ?? evalCase.bad_sources ?? []
    const prompt = buildExternalAiEvalPrompt({
      row,
      evalCase,
      expectedSources: expSources,
      badSources,
      recommendation,
    })
    try {
      await copyText(prompt)
      setCopiedEvalPrompt(true)
      window.setTimeout(() => setCopiedEvalPrompt(false), 1800)
    } catch (error) {
      alert(error instanceof Error ? error.message : "Copy failed")
    }
  }

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
              <p className="text-[12px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-2">Запит</p>
              <div className="bg-[#C9A84C]/5 border border-[#C9A84C]/15 rounded-xl px-4 py-3 text-sm text-[#E0E6ED]/90 leading-relaxed">
                {row.query_text}
              </div>
            </div>

            {/* Rewritten query */}
            {row.query_rewritten && row.query_rewritten !== row.query_text && (
              <div>
                <p className="text-[12px] font-black text-[#4E9FBF]/60 uppercase tracking-[0.2em] mb-2">RAG шукав по</p>
                <div className="bg-[#4E9FBF]/5 border border-[#4E9FBF]/20 rounded-xl px-4 py-3 text-sm text-[#E0E6ED]/80 leading-relaxed">
                  {row.query_rewritten}
                </div>
              </div>
            )}

            {/* Answer */}
            <div>
              <p className="text-[12px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-2">Відповідь</p>
              <div className="bg-[#1a2035] border border-[#C9A84C]/10 rounded-xl px-4 py-3 text-sm text-[#E0E6ED]/75 leading-relaxed whitespace-pre-wrap">
                {row.ai_response ?? <span className="text-[#6B7CA3] italic">Відповідь не збережена</span>}
              </div>
            </div>

            <div className="bg-[#0A0E1A] border border-[#C9A84C]/15 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">RAG eval</p>
                  <p className="text-xs text-[#6B7CA3] mt-1">
                    {evalCase
                      ? `${evalCase.answer_type ?? "mixed"} / ${evalCase.status ?? "ai_draft"} / confidence ${Math.round(Number(evalCase.eval_confidence ?? 0) * 100)}%`
                      : "No evaluation yet"}
                  </p>
                </div>
                {evalCase?.is_gold && (
                  <span className="text-[11px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-1">
                    GOLD
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={runAiEval}
                  disabled={evaluating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] text-xs font-bold disabled:opacity-60"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {evaluating ? "Evaluating..." : "AI оцінити"}
                </button>
                <button
                  onClick={copyExternalEvalPrompt}
                  disabled={!evalCase}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#4E9FBF]/30 text-[#8FD3F4] text-xs font-semibold disabled:opacity-40"
                  title="Copy a ready prompt for checking this RAG eval in another AI"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedEvalPrompt ? "Prompt copied" : "Copy AI review prompt"}
                </button>
                <button
                  onClick={() => patchEval({ status: "approved" })}
                  disabled={!evalCase || savingEval}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 text-xs font-semibold disabled:opacity-40"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Погодитись
                </button>
                <button
                  onClick={() => patchEval({ status: "approved", is_gold: true })}
                  disabled={!evalCase || savingEval}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#C9A84C]/30 text-[#C9A84C] text-xs font-semibold disabled:opacity-40"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Gold case
                </button>
                <button
                  onClick={() => setEditEval((v) => !v)}
                  disabled={!evalCase}
                  className="px-3 py-1.5 rounded-lg border border-[#6B7CA3]/30 text-[#A9B4C7] text-xs font-semibold disabled:opacity-40"
                >
                  Виправити джерела
                </button>
                <button
                  onClick={() => patchEval({ status: "rejected" })}
                  disabled={!evalCase || savingEval}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 text-xs font-semibold disabled:opacity-40"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Rejected
                </button>
              </div>

              {/* AI Recommendation block */}
              {recommendation && (
                <div className={`rounded-xl border px-4 py-3 space-y-1 ${
                  recommendation.action === "approve_gold"
                    ? "bg-[#C9A84C]/8 border-[#C9A84C]/30"
                    : recommendation.action === "approve"
                      ? "bg-emerald-500/8 border-emerald-500/25"
                      : "bg-red-500/8 border-red-500/25"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-[#6B7CA3]">Рекомендація ШІ</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      recommendation.action === "approve_gold"
                        ? "text-[#C9A84C] bg-[#C9A84C]/15"
                        : recommendation.action === "approve"
                          ? "text-emerald-300 bg-emerald-500/15"
                          : "text-red-300 bg-red-500/15"
                    }`}>
                      {recommendation.action === "approve_gold" ? "✦ Gold case" : recommendation.action === "approve" ? "✓ Approve" : "✗ Reject"}
                    </span>
                  </div>
                  {recommendation.reason && (
                    <p className="text-xs text-[#A9B4C7] leading-relaxed">{recommendation.reason}</p>
                  )}
                  {recommendation.action !== "reject" && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => patchEval({ status: "approved", is_gold: recommendation.is_gold || recommendation.action === "approve_gold" })}
                        disabled={savingEval}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${recommendation.action === "approve_gold" ? "bg-[#C9A84C] text-[#0A0E1A]" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"}`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {recommendation.action === "approve_gold" ? "Approve + Gold" : "Approve"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {evalCase && (() => {
                const expSources = annotatedExpected ?? (evalCase.expected_sources as AnnotatedSource[] | undefined) ?? []
                const badSources = annotatedBad ?? (evalCase.bad_sources as AnnotatedSource[] | undefined) ?? []
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[#6B7CA3] uppercase tracking-wider">Expected sources</p>
                        {expSources.length > 0 && (
                          <button
                            onClick={() => navigator.clipboard.writeText(JSON.stringify(
                              stripSourceAnnotations(expSources), null, 2
                            ))}
                            className="text-[10px] text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors"
                          >
                            Copy JSON
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {expSources.length > 0 ? expSources.map((source, i) => (
                          <div key={`exp-${i}`} className={`border rounded-lg px-2 py-1.5 ${source.in_db === false ? "bg-red-500/5 border-red-500/15" : source.in_db === true ? "bg-emerald-500/5 border-emerald-500/15" : "bg-[#1a2035]/60 border-[#C9A84C]/10"}`}>
                            <div className="flex items-start gap-1.5">
                              {source.in_db === true && <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />}
                              {source.in_db === false && <XCircleIcon className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />}
                              <div className="flex-1 min-w-0">
                                <p className="text-[#E0E6ED]/80 truncate">{sourceLabel(source, i)}</p>
                                {source.law_id && (
                                  <p className="text-[10px] font-mono text-[#6B7CA3]">
                                    {source.law_id}
                                    {source.in_db === true && <span className="ml-1 text-emerald-400">· є в базі</span>}
                                    {source.in_db === false && <span className="ml-1 text-red-400">· нема в базі</span>}
                                    {source.db_collection && <span className="ml-1 text-[#6B7CA3]">· {source.db_collection.replace("_v2", "")}</span>}
                                  </p>
                                )}
                                {source.reason && <p className="text-[#6B7CA3] mt-0.5">{source.reason}</p>}
                              </div>
                            </div>
                          </div>
                        )) : <p className="text-[#6B7CA3]">None</p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[#6B7CA3] uppercase tracking-wider mb-1">Bad sources</p>
                      <div className="space-y-1">
                        {badSources.length > 0 ? badSources.map((source, i) => (
                          <div key={`bad-${i}`} className="bg-red-500/5 border border-red-500/10 rounded-lg px-2 py-1.5">
                            <p className="text-[#E0E6ED]/80">{sourceLabel(source, i)}</p>
                            {source.law_id && (
                              <p className="text-[10px] font-mono text-[#6B7CA3]">
                                {source.law_id}
                                {source.in_db === true && <span className="ml-1 text-amber-400">· є в базі</span>}
                                {source.in_db === false && <span className="ml-1 text-[#6B7CA3]">· нема в базі</span>}
                              </p>
                            )}
                            {source.reason && <p className="text-[#6B7CA3] mt-0.5">{source.reason}</p>}
                          </div>
                        )) : <p className="text-[#6B7CA3]">None</p>}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {evalCase?.eval_notes && !editEval && (
                <p className="text-xs text-[#A9B4C7] bg-[#1a2035]/50 border border-[#C9A84C]/10 rounded-lg px-3 py-2">
                  {evalCase.eval_notes}
                </p>
              )}

              {editEval && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-[#C9A84C]/15 bg-[#C9A84C]/5 px-3 py-2 text-xs text-[#A9B4C7] leading-relaxed">
                    <p className="font-semibold text-[#E0E6ED] mb-1">Що це за масиви?</p>
                    <p>
                      <span className="text-[#C9A84C]">expected_sources</span> - джерела, які мали бути в правильній відповіді або реально підтверджують висновок.
                    </p>
                    <p>
                      <span className="text-red-300">bad_sources</span> - джерела, які AI використав невдало: не про це питання, лише фон або інша фактична ситуація.
                    </p>
                    <p className="mt-1">
                      Поля: <span className="text-[#E0E6ED]">num</span> - номер citation у відповіді, <span className="text-[#E0E6ED]">title</span> - назва джерела, <span className="text-[#E0E6ED]">law_id/collection</span> - технічні ідентифікатори, <span className="text-[#E0E6ED]">reason</span> - чому джерело добре або погане.
                    </p>
                  </div>
                  <label className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-[#C9A84C] mb-1">
                      expected_sources - правильні/потрібні джерела
                    </span>
                  <textarea
                    value={expectedText}
                    onChange={(e) => setExpectedText(e.target.value)}
                    className="w-full h-28 bg-[#070B14] border border-[#C9A84C]/15 rounded-lg px-3 py-2 text-xs text-[#E0E6ED] font-mono"
                    placeholder='[{"num":1,"title":"...","law_id":"...","collection":"...","reason":"чому джерело потрібне"}]'
                  />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-red-300 mb-1">
                      bad_sources - нерелевантні/шкідливі джерела
                    </span>
                  <textarea
                    value={badText}
                    onChange={(e) => setBadText(e.target.value)}
                    className="w-full h-28 bg-[#070B14] border border-[#C9A84C]/15 rounded-lg px-3 py-2 text-xs text-[#E0E6ED] font-mono"
                    placeholder='[{"num":2,"title":"...","law_id":"...","collection":"...","reason":"чому джерело погане"}]'
                  />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-[#6B7CA3] mb-1">
                      eval_notes - короткий висновок для нас
                    </span>
                  <textarea
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    className="w-full h-20 bg-[#070B14] border border-[#C9A84C]/15 rounded-lg px-3 py-2 text-xs text-[#E0E6ED]"
                    placeholder="Наприклад: відповідь коректна, але джерело 4 лише фонове."
                  />
                  </label>
                  <button
                    onClick={saveEvalEdits}
                    disabled={savingEval}
                    className="px-3 py-1.5 rounded-lg bg-[#C9A84C] text-[#0A0E1A] text-xs font-bold disabled:opacity-60"
                  >
                    Зберегти правки
                  </button>
                </div>
              )}
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
  const [queryPage, setQueryPage] = useState(1)
  const [queryPerPage, setQueryPerPage] = useState(25)
  const [querySortBy, setQuerySortBy] = useState<QuerySortBy>("created_at")
  const [querySortDir, setQuerySortDir] = useState<SortDir>("desc")
  const [activeQuery, setActiveQuery] = useState<QueryRow | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const { data, isLoading } = useSWR<AnalyticsData>(
    `/api/admin/analytics?days=${days}&page=${queryPage}&per_page=${queryPerPage}&sort_by=${querySortBy}&sort_dir=${querySortDir}`,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const periodTotal = data?.period ?? 0
  const catMax = data?.categories?.[0]?.[1] ?? 1
  const queriesTotal = data?.queriesTotal ?? 0
  const queriesPage = data?.queriesPage ?? queryPage
  const queriesPerPage = data?.queriesPerPage ?? queryPerPage
  const queriesTotalPages = Math.max(1, Math.ceil(queriesTotal / Math.max(queriesPerPage, 1)))
  const queriesFrom = queriesTotal === 0 ? 0 : (queriesPage - 1) * queriesPerPage + 1
  const queriesTo = Math.min(queriesPage * queriesPerPage, queriesTotal)

  function toggleQuerySort(sortBy: QuerySortBy) {
    if (querySortBy === sortBy) {
      setQuerySortDir((dir) => dir === "asc" ? "desc" : "asc")
    } else {
      setQuerySortBy(sortBy)
      setQuerySortDir(sortBy === "created_at" ? "desc" : "asc")
    }
    setQueryPage(1)
  }

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
              onClick={() => {
                setDays(d)
                setQueryPage(1)
              }}
              className={`px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${days === d
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
            <CollapsiblePanel
              icon={TrendingUp}
              title="Тренд (7 днів)"
              meta={`${data?.dailyTrend?.reduce((sum, item) => sum + item.count, 0) ?? 0} за 7д`}
            >
              <DailyChart data={data?.dailyTrend ?? []} />
            </CollapsiblePanel>

            {/* Sentiments */}
            <CollapsiblePanel
              icon={Smile}
              title="Настрій запитів"
              meta={`${data?.sentiments?.reduce((sum, [, count]) => sum + count, 0) ?? 0}`}
            >
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
            </CollapsiblePanel>
          </div>

          {/* Categories + Intents + Top users */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Categories */}
            <CollapsiblePanel
              icon={BarChart2}
              title="Категорії"
              meta={`${data?.categories?.length ?? 0}`}
              className="xl:col-span-1"
            >
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
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
            </CollapsiblePanel>

            {/* Intents */}
            <CollapsiblePanel
              icon={Brain}
              title="Намір запиту"
              meta={`${data?.intents?.length ?? 0}`}
            >
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
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
            </CollapsiblePanel>

            {/* Top users */}
            <CollapsiblePanel
              icon={Users}
              title="Топ користувачів"
              meta={`за ${days}д`}
            >
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto">
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
            </CollapsiblePanel>
          </div>

          {/* Eval Runner */}
          <EvalRunner />

          {/* Recent queries table */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-[#0d1120] border border-[#C9A84C]/15 rounded-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#C9A84C]/10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#C9A84C]" />
                <div>
                  <h2 className="text-sm font-semibold text-[#E0E6ED]">Останні запити</h2>
                  <p className="text-[11px] text-[#6B7CA3] mt-0.5">
                    {queriesFrom}-{queriesTo} з {queriesTotal}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={querySortBy}
                  onChange={(event) => {
                    setQuerySortBy(event.target.value as QuerySortBy)
                    setQueryPage(1)
                  }}
                  className="bg-[#0A0E1A] border border-[#C9A84C]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E0E6ED]"
                >
                  {QUERY_SORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{QUERY_SORT_LABELS[option]}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    setQuerySortDir((dir) => dir === "asc" ? "desc" : "asc")
                    setQueryPage(1)
                  }}
                  className="px-2.5 py-1.5 bg-[#0A0E1A] border border-[#C9A84C]/15 rounded-lg text-xs text-[#C9A84C] font-semibold"
                >
                  {querySortDir === "asc" ? "ASC" : "DESC"}
                </button>
                <select
                  value={queryPerPage}
                  onChange={(event) => {
                    setQueryPerPage(Number(event.target.value))
                    setQueryPage(1)
                  }}
                  className="bg-[#0A0E1A] border border-[#C9A84C]/15 rounded-lg px-2.5 py-1.5 text-xs text-[#E0E6ED]"
                >
                  {[25, 50, 100].map((value) => (
                    <option key={value} value={value}>{value}/page</option>
                  ))}
                </select>
              </div>
            </div>
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-[#C9A84C]/5">
              {(data?.recent ?? []).map((row) => {
                const sentCfg = SENTIMENT_CONFIG[row.sentiment ?? ""] ?? null
                const evalLabel = evalStatusLabel(row)
                return (
                  <div key={row.id} onClick={() => setActiveQuery(row)}
                    className="px-4 py-3.5 cursor-pointer hover:bg-[#C9A84C]/5 active:bg-[#C9A84C]/10 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm text-[#E0E6ED]/90 leading-snug line-clamp-3 flex-1">{row.query_text}</p>
                      <span className="text-[11px] text-[#6B7CA3] shrink-0">
                        {new Date(row.created_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {row.query_rewritten && row.query_rewritten !== row.query_text && (
                      <p className="text-[11px] text-[#4E9FBF]/80 line-clamp-1 mb-2">
                        RAG: {row.query_rewritten}
                      </p>
                    )}
                    {row.ai_response && (
                      <p className="text-[12px] text-[#A9B4C7]/80 line-clamp-2 mb-2 leading-relaxed">
                        {row.ai_response}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-1.5 mb-2">
                      <div className="rounded-lg bg-[#070B14] border border-[#C9A84C]/10 px-2 py-1">
                        <p className="text-[9px] uppercase tracking-wider text-[#6B7CA3]">Time</p>
                        <p className="text-[11px] font-semibold text-[#E0E6ED]/80">{formatTime(row.processing_time_ms)}</p>
                      </div>
                      <div className="rounded-lg bg-[#070B14] border border-[#C9A84C]/10 px-2 py-1">
                        <p className="text-[9px] uppercase tracking-wider text-[#6B7CA3]">Eval</p>
                        <p className="text-[11px] font-semibold text-[#C9A84C] truncate">{evalLabel}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {row.category && (
                        <span className="bg-[#C9A84C]/10 text-[#C9A84C] px-2 py-0.5 rounded-full text-[12px] font-medium">{row.category}</span>
                      )}
                      {sentCfg && (
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: sentCfg.color }}>
                          <sentCfg.icon className="w-3 h-3" />{sentCfg.label}
                        </span>
                      )}
                      {row.user_intent && (
                        <span className="text-[10px] text-[#A9B4C7] bg-[#1a2035]/70 rounded-full px-2 py-0.5">
                          {row.user_intent}
                        </span>
                      )}
                      <span className="text-[10px] text-[#6B7CA3] ml-auto">
                        {row.complexity_score ? `★ ${row.complexity_score}/5` : "★ —"}
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
                    {[
                      { label: "Запит", sort: null },
                      { label: "Категорія", sort: "category" },
                      { label: "Настрій", sort: "sentiment" },
                      { label: "Складність", sort: "complexity_score" },
                      { label: "Eval", sort: "eval_status" },
                      { label: "Час", sort: "processing_time_ms" },
                      { label: "Дата", sort: "created_at" },
                    ].map(({ label, sort }) => (
                      <th key={label} className="text-left px-4 py-3 text-[#6B7CA3] font-semibold uppercase tracking-wider whitespace-nowrap">
                        {sort ? (
                          <button
                            onClick={() => toggleQuerySort(sort as QuerySortBy)}
                            className="inline-flex items-center gap-1 hover:text-[#C9A84C] transition-colors"
                          >
                            {label}
                            <span className="text-[10px]">
                              {querySortBy === sort ? (querySortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </button>
                        ) : label}
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
                              color: ["", "#10B981", "#6EE7B7", "#F59E0B", "#F87171", "#EF4444"][row.complexity_score] ?? "#6B7CA3"
                            }}>
                              {"★".repeat(row.complexity_score)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[11px] text-[#C9A84C] bg-[#C9A84C]/10 border border-[#C9A84C]/15 rounded-full px-2 py-0.5">
                            {evalStatusLabel(row)}
                          </span>
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
                      <td colSpan={7} className="px-4 py-8 text-center text-[#6B7CA3]">
                        Записів поки немає - запити з&apos;являться тут після перших звернень
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#C9A84C]/10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[#6B7CA3]">
                Сторінка {queriesPage} з {queriesTotalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQueryPage((page) => Math.max(1, page - 1))}
                  disabled={queriesPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-[#C9A84C]/15 text-xs text-[#C9A84C] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Назад
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, queriesTotalPages) }, (_, i) => {
                    const start = Math.min(Math.max(1, queriesPage - 2), Math.max(1, queriesTotalPages - 4))
                    const page = start + i
                    if (page > queriesTotalPages) return null
                    return (
                      <button
                        key={page}
                        onClick={() => setQueryPage(page)}
                        className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${queriesPage === page
                          ? "bg-[#C9A84C] text-[#0A0E1A]"
                          : "border border-[#C9A84C]/15 text-[#6B7CA3] hover:text-[#E0E6ED]"
                          }`}
                      >
                        {page}
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => setQueryPage((page) => Math.min(queriesTotalPages, page + 1))}
                  disabled={queriesPage >= queriesTotalPages}
                  className="px-3 py-1.5 rounded-lg border border-[#C9A84C]/15 text-xs text-[#C9A84C] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Далі
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}

      {activeQuery && <QueryModal row={activeQuery} onClose={() => setActiveQuery(null)} />}
    </div>
  )
}
