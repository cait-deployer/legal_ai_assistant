"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, FileText, Clock, RefreshCw,
  Loader2, Zap, Settings, ArrowRight, Calendar,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type CollectionStats = { doc_count: number; law_count: number | null; law_count_per_collection: Record<string, number> | null }

type SyncStatus = {
  schedule_hour: number
  sources: Record<string, { enabled: boolean; running: boolean; last_sync: string | null }>
}

type ScrapeStatus = Record<string, { running: boolean; can_resume: boolean }>

// ── Helpers ───────────────────────────────────────────────────────────────────

const COL_LABELS: Record<string, string> = {
  // Рада V1
  rada_finance: "Фінанси / Податки",
  rada_state: "Держустрій",
  rada_personnel: "Кадри",
  rada_court: "Суд / Правосуддя",
  rada_intl: "Міжнародне",
  rada_labor: "Трудове / Соціальне",
  rada_civil: "Цивільне / Сімейне",
  rada_criminal: "Кримінальне",
  rada_admin: "Адміністративне",
  rada_housing: "Житлове / Будівництво",
  rada_land: "Земельне / АПК",
  rada_industry: "Бізнес / Промисловість",
  rada_other: "Інше (Рада)",
  laws_supreme: "Верховний суд",
  laws_wiki: "Legal Aid Wiki",
  laws_ccu: "Конституційний суд",
  laws_kmu: "Кабінет Міністрів",
  laws_positions: "Правові позиції ВС",
  laws_mod: "МОУ (PDF)",
  laws_zir: "ЗІР ДПС",
  // Рада V2
  rada_finance_v2: "Фінанси / Податки (V2)",
  rada_state_v2: "Держустрій (V2)",
  rada_personnel_v2: "Кадри (V2)",
  rada_court_v2: "Суд / Правосуддя (V2)",
  rada_intl_v2: "Міжнародне (V2)",
  rada_labor_v2: "Трудове / Соціальне (V2)",
  rada_civil_v2: "Цивільне / Сімейне (V2)",
  rada_criminal_v2: "Кримінальне (V2)",
  rada_admin_v2: "Адміністративне (V2)",
  rada_housing_v2: "Житлове / Будівництво (V2)",
  rada_land_v2: "Земельне / АПК (V2)",
  rada_industry_v2: "Бізнес / Промисловість (V2)",
  rada_other_v2: "Інше (Рада V2)",
  laws_supreme_v2: "Верховний суд (V2)",
  laws_wiki_v2: "Legal Aid Wiki (V2)",
  laws_ccu_v2: "Конституційний суд (V2)",
  laws_kmu_v2: "Кабінет Міністрів (V2)",
  laws_positions_v2: "Правові позиції ВС (V2)",
  laws_mod_v2: "МОУ (V2)",
  laws_zir_v2: "ЗІР ДПС (V2)",
}

function fmtTime(iso: string | null) {
  if (!iso) return null
  const d = Date.now() - new Date(iso).getTime()
  const h = Math.floor(d / 3600000)
  const min = Math.floor(d / 60000)
  if (min < 1) return "щойно"
  if (h < 1) return `${min} хв тому`
  if (h < 24) return `${h} год тому`
  return new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [scrape, setScrape] = useState<ScrapeStatus>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, syncRes, scrapeRes] = await Promise.allSettled([
        fetch("/api/admin/stats"),
        fetch("/api/admin/sync/status"),
        fetch("/api/admin/v2/scrape/status"),
      ])
      if (statsRes.status === "fulfilled" && statsRes.value.ok) setStats(await statsRes.value.json())
      if (syncRes.status === "fulfilled" && syncRes.value.ok) setSyncStatus(await syncRes.value.json())
      if (scrapeRes.status === "fulfilled" && scrapeRes.value.ok) setScrape(await scrapeRes.value.json())
      setLastUpdated(new Date())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Derived
  const enabledSources = syncStatus ? Object.values(syncStatus.sources).filter(s => s.enabled).length : 0
  const totalSources = syncStatus ? Object.keys(syncStatus.sources).length : 8
  const anyRunning = syncStatus
    ? Object.values(syncStatus.sources).some(s => s.running)
    : Object.values(scrape).some(s => s.running)
  const anyV2Running = Object.values(scrape).some(s => s.running)
  const scheduleHour = syncStatus?.schedule_hour ?? 1

  const lastSyncTimes = syncStatus
    ? Object.entries(syncStatus.sources)
      .filter(([, s]) => s.last_sync)
      .sort(([, a], [, b]) => new Date(b.last_sync!).getTime() - new Date(a.last_sync!).getTime())
    : []

  return (
    <div className="space-y-6 py-2">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#C9A84C]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <LayoutDashboard className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Огляд</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">Загальний стан системи URAI</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && (
            <p className="text-[12px] font-black text-[#C9A84C]/50 uppercase tracking-widest hidden sm:block">
              Оновлено {lastUpdated.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          <Button
            variant="ghost" size="sm" onClick={fetchAll} disabled={loading}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl h-9"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Оновити</span>
          </Button>
        </div>
      </div>

      {/* Cards row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

        {/* Card: Документи в базі */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Документів у базі</p>
            <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-[#C9A84C]" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : (
            <div className="text-4xl font-serif font-bold text-white tabular-nums">
              {(stats?.law_count ?? stats?.doc_count)?.toLocaleString("uk-UA") ?? "—"}
            </div>
          )}
          <p className="text-xs text-[#C9A84C]/50 mt-2 font-medium uppercase tracking-wider">
            {stats?.law_count
              ? `Унікальних законів · ${stats.doc_count?.toLocaleString("uk-UA")} чанків`
              : "Векторних чанків у Qdrant"}
          </p>
          {stats?.law_count_per_collection && (
            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-1">
              {Object.entries(stats.law_count_per_collection)
                .filter(([, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([col, count]) => (
                  <div key={col} className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-[#C9A84C]/50 truncate">
                      {COL_LABELS[col] ?? col}
                    </span>
                    <span className="text-[12px] font-bold text-[#C9A84C]/80 tabular-nums shrink-0">
                      {count.toLocaleString("uk-UA")}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Card: Авто-синхронізація */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Авто-синхронізація</p>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2.5 h-2.5 rounded-full ${enabledSources > 0 ? "bg-emerald-400" : "bg-gray-600"}`} />
                <span className="text-xl font-serif font-bold text-white">
                  {enabledSources > 0 ? `${enabledSources} / ${totalSources} джерел` : "Вимкнено"}
                </span>
              </div>
              <p className="text-[12px] text-[#C9A84C]/50 font-black uppercase tracking-wider mb-3">
                Щодня о {String(scheduleHour).padStart(2, "0")}:00 UTC · лише скрапінг
              </p>
              {lastSyncTimes.length > 0 && (
                <div className="space-y-1">
                  {lastSyncTimes.slice(0, 3).map(([src, s]) => (
                    <div key={src} className="flex justify-between text-[10px]">
                      <span className="text-gray-400 font-mono">{src}</span>
                      <span className="text-gray-400">{fmtTime(s.last_sync)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <Link href="/admin/sync" className="block mt-4">
            <div className="flex items-center gap-1 text-[12px] text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors">
              Керувати <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        </div>

        {/* Card: Статус скрапінгу */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 hover:border-[#C9A84C]/30 rounded-[2rem] p-6 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[12px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">Статус скрапінгу</p>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          {loading ? (
            <div className="h-10 w-28 rounded-xl bg-[#C9A84C]/5 animate-pulse" />
          ) : anyV2Running ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                <span className="text-xl font-serif font-bold text-amber-400">Виконується</span>
              </div>
              <div className="mt-2 space-y-1">
                {Object.entries(scrape)
                  .filter(([, s]) => s.running)
                  .map(([src]) => (
                    <div key={src} className="flex items-center gap-1.5 text-[12px] text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                      <span className="font-mono">{src}</span>
                    </div>
                  ))}
              </div>
            </>
          ) : Object.values(scrape).some(s => s.can_resume) ? (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="text-xl font-serif font-bold text-amber-400">Призупинено</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="text-xl font-serif font-bold text-white">Очікування</span>
            </div>
          )}
          <p className="text-[12px] text-[#C9A84C]/50 mt-3 font-black uppercase tracking-wider">
            {anyV2Running
              ? `${Object.values(scrape).filter(s => s.running).length} з 8 джерел`
              : "Всі 8 джерел"}
          </p>
          <Link href="/admin/sync" className="block mt-2">
            <div className="flex items-center gap-1 text-[12px] text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors">
              Керувати <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        </div>
      </div>

      {/* Sources mini-table */}
      {syncStatus && (
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-[2rem] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#C9A84C]" />
              <h2 className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Джерела — остання авто-синхронізація</h2>
            </div>
            <Link href="/admin/sync">
              <Button variant="ghost" size="sm" className="gap-1 h-8 text-xs text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 rounded-xl">
                Зведення <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(syncStatus.sources).map(([src, s]) => (
              <div key={src} className="bg-[#0A0E1A]/60 rounded-2xl px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
                  <span className="text-[12px] font-mono text-gray-400">{src}</span>
                  {s.running && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-auto" />}
                </div>
                <div className="text-[12px] text-gray-400">
                  {s.last_sync ? fmtTime(s.last_sync) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="bg-[#0d1120]/40 border border-dashed border-[#C9A84C]/10 rounded-[2rem] p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Швидкі дії</p>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Перейдіть до потрібного розділу</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/sync">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <Calendar className="w-4 h-4" /> Синхронізація
              </Button>
            </Link>
            <Link href="/admin/ai-settings">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <Settings className="w-4 h-4" /> AI Налаштування
              </Button>
            </Link>
            <Link href="/admin/coverage">
              <Button variant="ghost" size="sm" className="gap-2 h-9 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl text-xs">
                <FileText className="w-4 h-4" /> Покриття бази
              </Button>
            </Link>
          </div>
        </div>
      </div>

    </div>
  )
}
