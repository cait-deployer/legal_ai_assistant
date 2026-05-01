"use client"

import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Settings, Play, Pause, RotateCcw, Loader2, RefreshCw,
  CheckCircle, XCircle, Database, Scale, BookOpen, List, X,
  TrendingUp, Timer, AlertTriangle, Info, Map, Gavel, LayoutGrid,
} from "lucide-react"

// Маппінг код розділу РАДИ → Qdrant колекція
const SECTION_TO_COLLECTION: Record<string, string> = {
  h2: "rada_finance", h3: "rada_finance", h26: "rada_finance", h23: "rada_finance",
  h4: "rada_state",
  h27: "rada_personnel",
  h22: "rada_court", h30: "rada_court", h1: "rada_court",
  h11: "rada_intl",
  h19: "rada_labor", h20: "rada_labor",
  h5: "rada_civil", h16: "rada_civil", h13: "rada_civil",
  h25: "rada_criminal",
  h8: "rada_admin", h10: "rada_admin", h31: "rada_admin",
  h6: "rada_housing", h21: "rada_housing",
  h9: "rada_land", h18: "rada_land",
  h7: "rada_industry", h17: "rada_industry", h15: "rada_industry",
  h12: "rada_other", h14: "rada_other", h24: "rada_other",
  h28: "rada_other", h29: "rada_other", h32: "rada_other",
}

const COLLECTION_COLOR: Record<string, string> = {
  rada_finance: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  rada_state: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  rada_personnel: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  rada_court: "bg-red-500/15 text-red-400 border-red-500/20",
  rada_intl: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  rada_labor: "bg-green-500/15 text-green-400 border-green-500/20",
  rada_civil: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  rada_criminal: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  rada_admin: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  rada_housing: "bg-teal-500/15 text-teal-400 border-teal-500/20",
  rada_land: "bg-lime-500/15 text-lime-400 border-lime-500/20",
  rada_industry: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  rada_other: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
}

type SyncRun = {
  status: "success" | "error" | "paused"
  laws_processed: number
  duration_sec: number | null
  started_at: string | null
  source?: string
}
type SyncStats = {
  reliability_30d: { total: number; success: number; error: number; paused: number; pct: number | null }
  laws_30d: number
  laws_7d: number
  avg_duration_sec: number | null
  last_success_at: string | null
  last_14_runs: SyncRun[]
  alerts: { level: "error" | "warning" | "info"; message: string }[]
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec} с`
  return `${Math.floor(sec / 60)} хв ${sec % 60} с`
}

function MiniSparkline({ runs }: { runs: SyncRun[] }) {
  if (!runs.length) return null
  const maxLaws = Math.max(...runs.map(r => r.laws_processed), 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {runs.map((r, i) => {
        const h = Math.max(3, Math.round((r.laws_processed / maxLaws) * 32))
        const color = r.status === "success" ? "bg-emerald-500" : r.status === "error" ? "bg-red-500" : "bg-blue-400"
        return (
          <div key={i} title={`${r.started_at ? new Date(r.started_at).toLocaleDateString("uk-UA") : ""} · ${r.laws_processed} законів`}
            className="group relative flex-1 flex items-end cursor-default">
            <div className={`w-full rounded-sm opacity-60 group-hover:opacity-100 transition-opacity ${color}`} style={{ height: `${h}px` }} />
          </div>
        )
      })}
    </div>
  )
}

type Theme = { code: string; label: string }

type LogEntry = {
  ts: string
  message: string
  level: "info" | "success" | "error" | "warning"
}

type HistoryEntry = {
  id?: number
  source?: string
  status: string
  started_at: string
  finished_at?: string
  laws_processed?: number
  error_message?: string
}

type SourceState = {
  running: boolean
  pause_requested: boolean
  can_resume: boolean
  resume_progress?: { next_index: number; total: number } | null
  logs: LogEntry[]
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
        <CheckCircle className="w-3 h-3" /> Успішно
      </span>
    )
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
        <XCircle className="w-3 h-3" /> Помилка
      </span>
    )
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" /> Виконується
      </span>
    )
  if (status === "paused")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
        <Pause className="w-3 h-3" /> Призупинено
      </span>
    )
  return (
    <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[#C9A84C]/70 shrink-0">
      {status}
    </span>
  )
}

const SOURCES = [
  {
    key: "rada",
    label: "РАДА",
    description: "Закони з zakon.rada.gov.ua",
    icon: Database,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/10 border border-blue-500/20",
    triggerUrl: "/api/admin/rada/trigger",
    logsUrl: "/api/admin/rada/logs",
    pauseUrl: "/api/admin/rada/pause",
    resumeUrl: "/api/admin/rada/resume",
    supportsPause: true,
  },
  {
    key: "supreme",
    label: "Верховний Суд",
    description: "PDF-огляди з supreme.court.gov.ua",
    icon: Scale,
    iconColor: "text-purple-400",
    iconBg: "bg-purple-500/10 border border-purple-500/20",
    triggerUrl: "/api/admin/supreme/trigger",
    logsUrl: "/api/admin/supreme/logs",
    pauseUrl: "/api/admin/supreme/pause",
    resumeUrl: null,
    supportsPause: true,
  },
  {
    key: "wiki",
    label: "Wiki",
    description: "Роз'яснення з legalaid.wiki",
    icon: BookOpen,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border border-emerald-500/20",
    triggerUrl: "/api/admin/wiki/trigger",
    logsUrl: "/api/admin/wiki/logs",
    pauseUrl: "/api/admin/wiki/pause",
    resumeUrl: null,
    supportsPause: true,
  },
  {
    key: "ccu",
    label: "КСУ",
    description: "Рішення та висновки з ccu.gov.ua",
    icon: Gavel,
    iconColor: "text-amber-400",
    iconBg: "bg-amber-500/10 border border-amber-500/20",
    triggerUrl: "/api/admin/ccu/trigger",
    logsUrl: "/api/admin/ccu/logs",
    pauseUrl: "/api/admin/ccu/pause",
    resumeUrl: null,
    supportsPause: true,
  },
]

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  rada: { label: "РАДА", color: "text-blue-400" },
  supreme: { label: "ВС", color: "text-purple-400" },
  wiki: { label: "Wiki", color: "text-emerald-400" },
  ccu: { label: "КСУ", color: "text-amber-400" },
  templates: { label: "Шаблони", color: "text-amber-400" },
}

function SourceBadge({ source }: { source?: string }) {
  const info = SOURCE_LABELS[source ?? ""]
  if (!info) return <span className="text-[#E0E6ED]/30 text-xs">—</span>
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider ${info.color}`}>
      {info.label}
    </span>
  )
}

function logColor(level: string) {
  switch (level) {
    case "error": return "text-red-400"
    case "success": return "text-emerald-400"
    case "warning": return "text-amber-400"
    default: return "text-[#E0E6ED]/70"
  }
}

const QDRANT_MAP: { col: string; label: string; color: string; sections: { code: string; name: string }[] }[] = [
  {
    col: "rada_finance", label: "Фінанси", color: COLLECTION_COLOR.rada_finance,
    sections: [
      { code: "h2", name: "Бюджет" }, { code: "h3", name: "Фінансове право" },
      { code: "h26", name: "Банки та кредит" }, { code: "h23", name: "Ціни та тарифи" },
    ],
  },
  {
    col: "rada_state", label: "Держустрій", color: COLLECTION_COLOR.rada_state,
    sections: [{ code: "h4", name: "Держ. управління" }],
  },
  {
    col: "rada_personnel", label: "Кадри", color: COLLECTION_COLOR.rada_personnel,
    sections: [{ code: "h27", name: "Держ. служба / кадри" }],
  },
  {
    col: "rada_court", label: "Суд / правосуддя", color: COLLECTION_COLOR.rada_court,
    sections: [
      { code: "h22", name: "Судоустрій" }, { code: "h30", name: "Судочинство" },
      { code: "h1", name: "Конституційне право" },
    ],
  },
  {
    col: "rada_intl", label: "Міжнародне", color: COLLECTION_COLOR.rada_intl,
    sections: [{ code: "h11", name: "Міжнародне право" }],
  },
  {
    col: "rada_labor", label: "Трудове", color: COLLECTION_COLOR.rada_labor,
    sections: [{ code: "h19", name: "Трудове право" }, { code: "h20", name: "Соціальний захист" }],
  },
  {
    col: "rada_civil", label: "Цивільне", color: COLLECTION_COLOR.rada_civil,
    sections: [
      { code: "h5", name: "Цивільне право" }, { code: "h16", name: "Цивільний процес" },
      { code: "h13", name: "Власність" },
    ],
  },
  {
    col: "rada_criminal", label: "Кримінальне", color: COLLECTION_COLOR.rada_criminal,
    sections: [{ code: "h25", name: "Кримінальне право" }],
  },
  {
    col: "rada_admin", label: "Адміністративне", color: COLLECTION_COLOR.rada_admin,
    sections: [
      { code: "h8", name: "Адміністративне право" }, { code: "h10", name: "Адмін. процес" },
      { code: "h31", name: "Адмін. відповідальність" },
    ],
  },
  {
    col: "rada_housing", label: "Житлове", color: COLLECTION_COLOR.rada_housing,
    sections: [{ code: "h6", name: "Житлове право" }, { code: "h21", name: "Комунальне госп." }],
  },
  {
    col: "rada_land", label: "Земельне", color: COLLECTION_COLOR.rada_land,
    sections: [{ code: "h9", name: "Земельне право" }, { code: "h18", name: "Природоресурсне" }],
  },
  {
    col: "rada_industry", label: "Бізнес / Галузі", color: COLLECTION_COLOR.rada_industry,
    sections: [
      { code: "h7", name: "Підприємництво" }, { code: "h17", name: "Промисловість" },
      { code: "h15", name: "Транспорт / зв'язок" },
    ],
  },
  {
    col: "rada_other", label: "Інше", color: COLLECTION_COLOR.rada_other,
    sections: [
      { code: "h12", name: "Митне право" }, { code: "h14", name: "Освіта / наука" },
      { code: "h24", name: "Охорона здоров'я" }, { code: "h28", name: "Безпека / оборона" },
      { code: "h29", name: "Довкілля" }, { code: "h32", name: "Інші галузі" },
    ],
  },
]

const OTHER_COLLECTIONS = [
  { col: "laws_supreme", label: "Верховний суд", color: "bg-purple-500/15 text-purple-400 border-purple-500/20", desc: "PDF-огляди supreme.court.gov.ua" },
  { col: "laws_wiki", label: "Wiki", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20", desc: "Роз'яснення legalaid.wiki" },
  { col: "laws_ccu", label: "КСУ", color: "bg-amber-500/15 text-amber-400 border-amber-500/20", desc: "Рішення та висновки ccu.gov.ua" },
]

function QdrantMapModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl bg-[#0d1120] border border-[#C9A84C]/30 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#C9A84C]/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center">
              <LayoutGrid className="w-4 h-4 text-[#C9A84C]" />
            </div>
            <div>
              <h2 className="font-semibold text-[#E0E6ED]">Карта Qdrant колекцій</h2>
              <p className="text-xs text-[#E0E6ED]/50 mt-0.5">16 колекцій · розподіл розділів РАДИ</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#C9A84C]/50 hover:text-[#C9A84C]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {/* Rada collections */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/60 mb-3 flex items-center gap-2">
              <Database className="w-3.5 h-3.5" /> РАДА (13 колекцій)
            </p>
            <div className="space-y-2">
              {QDRANT_MAP.map(({ col, label, color, sections }) => (
                <div key={col} className="flex gap-3 items-start">
                  <span className={`shrink-0 mt-0.5 inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold min-w-[110px] justify-center ${color}`}>
                    {label}
                  </span>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {sections.map(s => (
                      <span key={s.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[10px] text-[#E0E6ED]/70">
                        <span className="font-mono text-[#C9A84C]/50">{s.code}</span>
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Other collections */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/60 mb-3 flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5" /> Інші джерела (3 колекції)
            </p>
            <div className="space-y-2">
              {OTHER_COLLECTIONS.map(({ col, label, color, desc }) => (
                <div key={col} className="flex gap-3 items-center">
                  <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold min-w-[110px] justify-center ${color}`}>
                    {label}
                  </span>
                  <span className="text-xs text-[#E0E6ED]/50">{col}</span>
                  <span className="text-xs text-[#E0E6ED]/30">· {desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex px-6 py-4 border-t border-[#C9A84C]/10 shrink-0">
          <Button variant="outline" onClick={onClose} className="ml-auto border-[#C9A84C]/20 text-[#E0E6ED]/60 hover:text-[#E0E6ED]">
            Закрити
          </Button>
        </div>
      </div>
    </div>
  )
}

function SourceCard({ source }: { source: typeof SOURCES[0] }) {
  const [state, setState] = useState<SourceState>({
    running: false,
    pause_requested: false,
    can_resume: false,
    resume_progress: null,
    logs: [],
  })
  const [error, setError] = useState("")
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const Icon = source.icon

  // Themes modal (only for Rada)
  const [showThemesModal, setShowThemesModal] = useState(false)
  const [themes, setThemes] = useState<Theme[]>([])
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())

  const fetchLogs = async () => {
    try {
      const r = await fetch(source.logsUrl)
      const d = await r.json()
      setState({
        running: d.running ?? false,
        pause_requested: d.pause_requested ?? false,
        can_resume: d.can_resume ?? false,
        resume_progress: d.resume_progress ?? null,
        logs: d.live_logs ?? [],
      })
    } catch { /* silently ignore network errors */ }
  }

  useEffect(() => {
    const fetchData = async () => {
      return await fetchLogs()
    }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state.running) {
      pollRef.current = setInterval(fetchLogs, 3000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [state.running])

  useEffect(() => {
    const el = logsContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.logs])

  const openRunModal = async () => {
    if (state.running) return
    if (source.key !== "rada") { handleRun(null); return }
    setError("")
    if (themes.length === 0) {
      try {
        const r = await fetch("/api/admin/rada/themes")
        if (r.ok) setThemes(await r.json())
      } catch { /* show modal anyway */ }
    }
    setSelectedCodes(new Set())
    setShowThemesModal(true)
  }

  const handleRun = async (sectionCodes: string[] | null) => {
    setShowThemesModal(false)
    if (state.running) return
    setError("")
    setState((s) => ({ ...s, running: true, logs: [], can_resume: false }))
    try {
      const isRada = source.key === "rada"
      const res = await fetch(source.triggerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: isRada ? JSON.stringify({ section_codes: sectionCodes }) : "{}",
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка запуску")
        setState((s) => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setError("Не вдалося підключитися до бекенду")
      setState((s) => ({ ...s, running: false }))
    }
  }

  const toggleTheme = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  const handlePause = async () => {
    if (!source.pauseUrl) return
    setError("")
    try {
      await fetch(source.pauseUrl, { method: "POST" })
      setState((s) => ({ ...s, pause_requested: true }))
    } catch {
      setError("Не вдалося надіслати команду паузи")
    }
  }

  const handleResume = async () => {
    if (!source.resumeUrl) return
    setError("")
    setState((s) => ({ ...s, running: true, can_resume: false }))
    try {
      const res = await fetch(source.resumeUrl, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail ?? d.error ?? "Помилка відновлення")
        setState((s) => ({ ...s, running: false }))
        return
      }
      await fetchLogs()
    } catch {
      setError("Не вдалося підключитися до бекенду")
      setState((s) => ({ ...s, running: false }))
    }
  }

  const showLogs = state.running || state.logs.length > 0

  return (
    <div
      className={`bg-[#0d1120]/60 border rounded-2xl transition-all duration-200 ${state.running
          ? state.pause_requested
            ? "border-blue-500/30"
            : "border-amber-500/30"
          : state.can_resume
            ? "border-blue-500/20"
            : "border-[#C9A84C]/10 hover:border-[#C9A84C]/20"
        }`}
    >
      <div className="p-5">
        {/* Top row: icon + name + actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${source.iconBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5 h-5 ${source.iconColor}`} />
            </div>
            <div>
              <p className="font-semibold text-[#E0E6ED] text-sm">{source.label}</p>
              <p className="text-xs text-[#E0E6ED]/70 mt-0.5">{source.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Status badge */}
            {state.running && state.pause_requested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Зупиняємось...
              </span>
            )}
            {state.running && !state.pause_requested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Loader2 className="w-3 h-3 animate-spin" /> Виконується
              </span>
            )}

            {/* Pause button (only while running, before pause is requested) */}
            {source.supportsPause && state.running && !state.pause_requested && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handlePause}
                className="gap-1.5 h-9 rounded-xl border border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/10 text-blue-400 font-black uppercase tracking-wider text-[10px]"
              >
                <Pause className="w-3.5 h-3.5" /> Пауза
              </Button>
            )}

            {/* Resume button (when paused and not running) */}
            {source.supportsPause && !state.running && state.can_resume && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleResume}
                className="gap-1.5 h-9 rounded-xl border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-emerald-400 font-black uppercase tracking-wider text-[10px]"
              >
                <Play className="w-3.5 h-3.5" /> Відновити
              </Button>
            )}

            {/* Start / restart button */}
            <Button
              size="sm"
              onClick={openRunModal}
              disabled={state.running}
              className="gap-1.5 h-9 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#C9A84C]/10 disabled:opacity-40"
            >
              {state.running ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Йде...</>
              ) : state.can_resume ? (
                <><RotateCcw className="w-3.5 h-3.5" /> З початку</>
              ) : source.key === "rada" ? (
                <><List className="w-3.5 h-3.5" /> Вибрати теми</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> Запустити</>
              )}
            </Button>
          </div>
        </div>

        {/* Resume progress bar */}
        {source.supportsPause && state.can_resume && state.resume_progress && (
          <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-wider">
                Збережений прогрес
              </span>
              <span className="text-[10px] font-mono text-blue-400">
                {state.resume_progress.next_index} / {state.resume_progress.total} законів
              </span>
            </div>
            <div className="w-full bg-[#0A0E1A] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-400 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(
                    (state.resume_progress.next_index / state.resume_progress.total) * 100
                  )}%`,
                }}
              />
            </div>
            <p className="text-[10px] text-[#E0E6ED]/50 mt-1.5">
              Натисніть «Відновити» щоб продовжити з місця зупинки,
              або «З початку» щоб почати заново.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>

      {/* Themes modal (Rada only) */}
      {showThemesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowThemesModal(false)} />
          <div className="relative w-full max-w-2xl bg-[#0d1120] border border-[#C9A84C]/30 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#C9A84C]/10 shrink-0">
              <div>
                <h2 className="font-semibold text-[#E0E6ED]">Вибір розділів для скрапінгу</h2>
                <p className="text-xs text-[#E0E6ED]/50 mt-0.5">Залиште порожнім щоб скрапити всі дефолтні розділи</p>
              </div>
              <button onClick={() => setShowThemesModal(false)} className="text-[#C9A84C]/50 hover:text-[#C9A84C]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-3 px-6 py-3 border-b border-[#C9A84C]/10 shrink-0 flex-wrap">
              <button onClick={() => setSelectedCodes(new Set(themes.map(t => t.code)))} className="text-xs font-semibold text-[#C9A84C] hover:underline">Вибрати всі</button>
              <span className="text-[#C9A84C]/30">·</span>
              <button onClick={() => setSelectedCodes(new Set())} className="text-xs font-semibold text-[#C9A84C] hover:underline">Зняти всі</button>
              {selectedCodes.size > 0 && <span className="text-xs text-[#E0E6ED]/40 ml-auto">Вибрано: {selectedCodes.size} / {themes.length}</span>}
            </div>
            {/* Legend */}
            <div className="px-6 py-2 border-b border-[#C9A84C]/10 shrink-0">
              <p className="text-[10px] text-[#E0E6ED]/30 mb-1.5 font-black uppercase tracking-wider flex items-center gap-1.5">
                <Map className="w-3 h-3" /> Розділ → Qdrant колекція
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries({
                  rada_finance: "Фінанси", rada_state: "Держустрій", rada_personnel: "Кадри",
                  rada_court: "Суд", rada_intl: "Міжнар.", rada_labor: "Трудове",
                  rada_civil: "Цивільне", rada_criminal: "Кримінальне", rada_admin: "Адмін.",
                  rada_housing: "Житлове", rada_land: "Земельне", rada_industry: "Бізнес",
                  rada_other: "Інше",
                }).map(([col, label]) => (
                  <span key={col} className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${COLLECTION_COLOR[col]}`}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              {themes.length === 0 ? (
                <div className="flex items-center justify-center py-8 gap-2 text-[#E0E6ED]/40">
                  <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Завантаження...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {themes.map(t => {
                    const col = SECTION_TO_COLLECTION[t.code] ?? "rada_other"
                    const colColor = COLLECTION_COLOR[col] ?? COLLECTION_COLOR.rada_other
                    const colLabel = col.replace("rada_", "")
                    return (
                      <label key={t.code} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${selectedCodes.has(t.code) ? "border-[#C9A84C]/50 bg-[#C9A84C]/5" : "border-[#C9A84C]/10 hover:border-[#C9A84C]/30"}`}>
                        <input type="checkbox" checked={selectedCodes.has(t.code)} onChange={() => toggleTheme(t.code)} className="accent-[#C9A84C] shrink-0" />
                        <span className="font-mono text-[10px] text-[#C9A84C]/40 shrink-0 w-7">{t.code}</span>
                        <span className="text-xs text-[#E0E6ED]/80 leading-tight flex-1 min-w-0">{t.label}</span>
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${colColor}`}>
                          {colLabel}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-[#C9A84C]/10 shrink-0">
              <Button variant="outline" onClick={() => setShowThemesModal(false)} className="flex-1 border-[#C9A84C]/20 text-[#E0E6ED]/60 hover:text-[#E0E6ED]">Скасувати</Button>
              <Button onClick={() => handleRun(selectedCodes.size > 0 ? [...selectedCodes] : null)} className="flex-1 gap-2 bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black">
                <Play className="w-4 h-4" />
                {selectedCodes.size === 0 ? "Всі розділи" : `Запустити (${selectedCodes.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Live log terminal */}
      {showLogs && (
        <div className="px-5 pb-5 pt-0">
          <div className="bg-[#0A0E1A]/80 rounded-xl border border-[#C9A84C]/10 font-mono text-xs h-48 overflow-y-auto p-3 space-y-0.5">
            {state.logs.length === 0 ? (
              <p className="text-[#C9A84C]/50">Очікування логів...</p>
            ) : (
              state.logs.map((entry, i) => (
                <div key={i} className={`flex gap-2 ${logColor(entry.level)}`}>
                  <span className="shrink-0 opacity-60 tabular-nums">
                    {new Date(entry.ts).toLocaleTimeString("uk-UA")}
                  </span>
                  <span className="break-all">{entry.message}</span>
                </div>
              ))
            )}
            <div ref={logsContainerRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null)
  const [showQdrantMap, setShowQdrantMap] = useState(false)

  const fetchHistory = async () => {
    setHistoryLoading(true)
    try {
      const [logRes, statsRes] = await Promise.all([
        fetch("/api/admin/logs"),
        fetch("/api/admin/sync/stats"),
      ])
      const d = await logRes.json()
      setHistory(Array.isArray(d) ? d : [])
      if (statsRes.ok) setSyncStats(await statsRes.json())
      setLastUpdated(new Date())
    } catch { /* ignore */ }
    finally { setHistoryLoading(false) }
  }

  useEffect(() => { fetchHistory() }, [])

  return (
    <div className="flex flex-col h-full">
      {showQdrantMap && <QdrantMapModal onClose={() => setShowQdrantMap(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#C9A84C]/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <Settings className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Синхронізація</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">Керування джерелами та запусками синхронізації</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowQdrantMap(true)}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl"
          >
            <LayoutGrid className="w-4 h-4" />
            Карта колекцій
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchHistory}
            disabled={historyLoading}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl shrink-0"
          >
            {historyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Оновити</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">
        {/* Sources */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">
            Джерела даних
          </h2>
          <div className="space-y-3">
            {SOURCES.map((src) => (
              <SourceCard key={src.key} source={src} />
            ))}
          </div>
        </section>

        {/* Sync analytics panel */}
        {syncStats && (
          <section>
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">
              Аналітика
            </h2>
            <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-4">
              {/* Alerts */}
              {syncStats.alerts.map((a, i) => (
                <div key={i} className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm ${a.level === "error" ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : a.level === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                      : "bg-[#C9A84C]/5 border-[#C9A84C]/15 text-[#C9A84C]/80"
                  }`}>
                  {a.level === "error" && <XCircle className="w-4 h-4 shrink-0" />}
                  {a.level === "warning" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                  {a.level === "info" && <Info className="w-4 h-4 shrink-0" />}
                  {a.message}
                </div>
              ))}

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#0A0E1A]/60 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Надійність / 30 дн
                  </p>
                  <p className={`text-xl font-bold mt-1 ${syncStats.reliability_30d.pct == null ? "text-[#E0E6ED]/30"
                      : syncStats.reliability_30d.pct >= 80 ? "text-emerald-400"
                        : syncStats.reliability_30d.pct >= 50 ? "text-amber-400"
                          : "text-red-400"
                    }`}>
                    {syncStats.reliability_30d.pct != null ? `${syncStats.reliability_30d.pct}%` : "—"}
                  </p>
                  <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">
                    {syncStats.reliability_30d.success} з {syncStats.reliability_30d.total} запусків
                  </p>
                </div>
                <div className="bg-[#0A0E1A]/60 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Законів додано
                  </p>
                  <p className="text-xl font-bold mt-1 text-white">
                    {syncStats.laws_30d.toLocaleString("uk-UA")}
                  </p>
                  <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">{syncStats.laws_7d} за 7 днів</p>
                </div>
                <div className="bg-[#0A0E1A]/60 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/50 flex items-center gap-1">
                    <Timer className="w-3 h-3" /> Сер. тривалість
                  </p>
                  <p className="text-xl font-bold mt-1 text-white">{fmtDuration(syncStats.avg_duration_sec)}</p>
                  <p className="text-[10px] text-[#E0E6ED]/40 mt-0.5">успішних запусків</p>
                </div>
              </div>

              {/* Sparkline */}
              {syncStats.last_14_runs.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C]/40 mb-2">
                    Останні {syncStats.last_14_runs.length} запусків
                    <span className="ml-2 font-normal normal-case text-[#E0E6ED]/30">· висота = кількість законів</span>
                  </p>
                  <MiniSparkline runs={syncStats.last_14_runs} />
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-[#E0E6ED]/40">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> успіх</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> помилка</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" /> призупинено</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* History */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">
            Історія синхронізацій
          </h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#C9A84C]/10">
              <p className="text-sm text-[#E0E6ED]/70">Останні 20 запусків</p>
              {lastUpdated && (
                <span className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-widest">
                  {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="p-5">
              {historyLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-[#E0E6ED]/30 py-6 text-center">
                  Синхронізацій ще не було.
                </p>
              ) : (
                <div className="rounded-xl border border-[#C9A84C]/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#C9A84C]/10 bg-[#0A0E1A]/40">
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider w-20 hidden sm:table-cell">Джерело</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider w-32">Статус</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider">Початок</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider hidden sm:table-cell">Кінець</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider w-24">Законів</th>
                        <th className="text-left px-4 py-3 text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider hidden md:table-cell">Повідомлення</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr
                          key={h.id ?? i}
                          className="border-b border-[#C9A84C]/5 last:border-0 hover:bg-[#C9A84C]/3 transition-colors"
                        >
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <SourceBadge source={h.source} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={h.status} />
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs">
                            {h.started_at
                              ? new Date(h.started_at).toLocaleString("uk-UA", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden sm:table-cell">
                            {h.finished_at
                              ? new Date(h.finished_at).toLocaleString("uk-UA", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {h.laws_processed != null ? (
                              <span className="font-serif font-bold text-[#C9A84C]">
                                {h.laws_processed}
                              </span>
                            ) : (
                              <span className="text-[#E0E6ED]/30">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#E0E6ED]/70 text-xs hidden md:table-cell max-w-[220px]">
                            <span className="truncate block">{h.error_message ?? "—"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
