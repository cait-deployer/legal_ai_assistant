"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  RefreshCw, Database, Scale, Gavel, BookMarked,
  CheckCircle, XCircle, Loader2, Play, ExternalLink,
  AlertCircle, Clock, Globe,
} from "lucide-react"

type SourceStatus = {
  key: string
  name: string
  href: string | null
  icon: React.ElementType
  color: string
  running: boolean
  lastSync: string | null
  lastStatus: "success" | "error" | "running" | null
  docsProcessed: number | null
  errorMessage?: string
}

const SOURCES = [
  { key: "rada",    name: "Рада",          href: "/admin/settings", icon: Database,   color: "blue",   apiLogs: "/api/admin/rada/logs",     apiTrigger: "/api/admin/rada/trigger" },
  { key: "supreme", name: "Верховний Суд", href: "/admin/supreme",  icon: Scale,      color: "purple", apiLogs: "/api/admin/supreme/logs",  apiTrigger: "/api/admin/supreme/trigger" },
  { key: "wiki",    name: "Wiki",          href: null,              icon: Globe,      color: "teal",   apiLogs: "/api/admin/wiki/logs",     apiTrigger: "/api/admin/wiki/trigger" },
  { key: "ccu",     name: "КСУ",           href: "/admin/ccu",      icon: Gavel,      color: "red",    apiLogs: "/api/admin/ccu/logs",      apiTrigger: "/api/admin/ccu/trigger" },
  { key: "lpd",     name: "Позиції ВС",    href: "/admin/lpd",      icon: BookMarked, color: "amber",  apiLogs: "/api/admin/lpd/logs",      apiTrigger: "/api/admin/lpd/trigger" },
] as const

const colorMap: Record<string, string> = {
  blue:   "from-blue-500/10 to-blue-500/5 border-blue-500/20",
  purple: "from-purple-500/10 to-purple-500/5 border-purple-500/20",
  teal:   "from-teal-500/10 to-teal-500/5 border-teal-500/20",
  red:    "from-red-500/10 to-red-500/5 border-red-500/20",
  amber:  "from-amber-500/10 to-amber-500/5 border-amber-500/20",
}

const iconColorMap: Record<string, string> = {
  blue:   "text-blue-400",
  purple: "text-purple-400",
  teal:   "text-teal-400",
  red:    "text-red-400",
  amber:  "text-amber-400",
}

function StatusBadge({ status }: { status: SourceStatus["lastStatus"] | "idle" }) {
  if (status === "running")
    return (
      <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/30 bg-amber-500/10 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> Виконується
      </Badge>
    )
  if (status === "success")
    return (
      <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-xs">
        <CheckCircle className="w-3 h-3" /> Успішно
      </Badge>
    )
  if (status === "error")
    return (
      <Badge variant="outline" className="gap-1 text-red-400 border-red-400/30 bg-red-500/10 text-xs">
        <XCircle className="w-3 h-3" /> Помилка
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1 text-[#E0E6ED]/40 border-[#E0E6ED]/10 text-xs">
      <Clock className="w-3 h-3" /> Очікування
    </Badge>
  )
}

export default function SyncOverviewPage() {
  const [statuses, setStatuses]   = useState<Record<string, SourceStatus>>({})
  const [loading,  setLoading]    = useState(true)
  const [triggering, setTriggering] = useState<Record<string, boolean>>({})

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled(
      SOURCES.map(async (src) => {
        try {
          const r = await fetch(src.apiLogs)
          if (!r.ok) return null
          const d = await r.json()
          const history: any[] = d.history ?? []
          const last = history[0]
          return {
            key:           src.key,
            name:          src.name,
            href:          src.href,
            icon:          src.icon,
            color:         src.color,
            running:       d.running ?? false,
            lastSync:      last?.finished_at ?? last?.started_at ?? null,
            lastStatus:    d.running ? "running" : (last?.status ?? null),
            docsProcessed: last?.laws_processed ?? null,
            errorMessage:  last?.error_message,
          } as SourceStatus
        } catch {
          return null
        }
      })
    )

    const map: Record<string, SourceStatus> = {}
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) {
        map[SOURCES[i].key] = r.value
      } else {
        // fallback placeholder
        map[SOURCES[i].key] = {
          key:           SOURCES[i].key,
          name:          SOURCES[i].name,
          href:          SOURCES[i].href,
          icon:          SOURCES[i].icon,
          color:         SOURCES[i].color,
          running:       false,
          lastSync:      null,
          lastStatus:    null,
          docsProcessed: null,
        }
      }
    })
    setStatuses(map)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const handleTrigger = async (src: typeof SOURCES[number]) => {
    setTriggering(p => ({ ...p, [src.key]: true }))
    try {
      await fetch(src.apiTrigger, { method: "POST" })
      await fetchAll()
    } finally {
      setTriggering(p => ({ ...p, [src.key]: false }))
    }
  }

  const anyRunning = Object.values(statuses).some(s => s.running)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2 border-[#C9A84C]/20 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#C9A84C]/10 rounded-xl shrink-0">
            <RefreshCw className="w-10 h-10 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-[#E0E6ED]">Синхронізація</h1>
            <p className="text-lg text-[#E0E6ED]/50 mt-1">
              Зведення по всіх джерелах даних
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {anyRunning && (
            <Badge variant="outline" className="gap-1.5 text-amber-500 border-amber-500/30 bg-amber-500/10">
              <Loader2 className="w-3 h-3 animate-spin" /> Є активні задачі
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAll}
            className="gap-2 border-[#C9A84C]/20 text-[#E0E6ED]/70 hover:text-[#E0E6ED] hover:border-[#C9A84C]/40"
          >
            <RefreshCw className="w-4 h-4" /> Оновити
          </Button>
        </div>
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto pt-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]/50" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
            {SOURCES.map((src) => {
              const s = statuses[src.key]
              if (!s) return null
              const Icon = src.icon

              return (
                <Card
                  key={src.key}
                  className={`bg-gradient-to-br ${colorMap[src.color]} border transition-all duration-200 hover:shadow-lg`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg bg-black/20`}>
                          <Icon className={`w-5 h-5 ${iconColorMap[src.color]}`} />
                        </div>
                        <div>
                          <CardTitle className="text-base text-[#E0E6ED]">{s.name}</CardTitle>
                          {s.lastSync && (
                            <CardDescription className="text-xs mt-0.5">
                              {new Date(s.lastSync).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })}
                            </CardDescription>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={s.running ? "running" : s.lastStatus} />
                    </div>
                  </CardHeader>

                  <CardContent className="pt-0">
                    {/* Stats row */}
                    <div className="flex items-center gap-4 mb-4">
                      {s.docsProcessed != null && (
                        <div>
                          <p className="text-2xl font-bold text-[#E0E6ED]">{s.docsProcessed.toLocaleString()}</p>
                          <p className="text-xs text-[#E0E6ED]/40">оброблено документів</p>
                        </div>
                      )}
                      {s.errorMessage && (
                        <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg p-2 flex-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="truncate">{s.errorMessage}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5 h-8 text-xs bg-white/5 hover:bg-white/10 text-[#E0E6ED] border border-white/10"
                        onClick={() => handleTrigger(src)}
                        disabled={s.running || triggering[src.key]}
                      >
                        {s.running || triggering[src.key]
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Виконується</>
                          : <><Play className="w-3 h-3" /> Запустити</>}
                      </Button>
                      {src.href && (
                        <Link href={src.href}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 h-8 text-xs text-[#E0E6ED]/50 hover:text-[#E0E6ED] hover:bg-white/5"
                          >
                            <ExternalLink className="w-3 h-3" /> Детально
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Info */}
        <div className="mt-6 p-4 rounded-xl border border-[#C9A84C]/10 bg-[#C9A84C]/5">
          <p className="text-sm text-[#E0E6ED]/50">
            Сторінка автоматично оновлюється кожні 10 секунд. Для детального управління кожним джерелом — перейдіть на відповідну підсторінку.
          </p>
        </div>
      </div>
    </div>
  )
}
