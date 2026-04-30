"use client"

import { useState, useEffect, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type MetaItem = {
  nreg: string
  title: string
  doc_type: string
  status: number
  status_name: string
  is_dead: boolean
  dead_by_status: boolean
  dead_by_link: boolean
  dead_by_text: boolean
  no_text: boolean
  adopted_date: string
  last_edition: string
  dead_since: string
  replaced_by: string[]
  cancelled_by: string[]
  cancelled_by_text: string[]
  theme: string
  classifiers: string[]
  org: string
  editions_cnt: number
  url: string
  enriched_at: string
}

type MetaListResponse = {
  items: MetaItem[]
  total: number
  source: string
}

type LogEntry = { ts: string; message: string; level: string }

type EnrichSubState = {
  running: boolean
  pause_requested: boolean
  live_logs: LogEntry[]
  state: Record<string, unknown>
}

type EnrichStatus = {
  enrich: EnrichSubState
  qdrant_meta: EnrichSubState
  text_cancellations: EnrichSubState
  text_missing_check: EnrichSubState
}

type TextReportItem = {
  cancelled_nreg?: string
  nreg?: string
  by?: string
  source_title?: string
  evidence?: string
  status?: string
  title?: string
  mentions?: number
}

type TextReport = {
  kind: string
  exists: boolean
  summary: Record<string, unknown>
  items: TextReportItem[]
  total: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ item }: { item: MetaItem }) {
  if (item.is_dead) {
    if (item.dead_by_text) {
      return (
        <span
          className="px-2 py-0.5 rounded text-xs font-medium bg-amber-900/60 text-amber-300"
          title={item.cancelled_by_text?.length ? `by: ${item.cancelled_by_text.join(", ")}` : undefined}
        >
          Скасовано (текст)
        </span>
      )
    }
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-900/60 text-red-300">
        {item.dead_by_link ? "Скасовано (зв'язок)" : "Втратив чинність"}
      </span>
    )
  }
  if (item.no_text) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-700 text-zinc-300">
        Без тексту
      </span>
    )
  }
  if (item.status === 0) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-900/60 text-amber-300">
        Не визначено
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/60 text-emerald-300">
      {item.status_name || "Чинний"}
    </span>
  )
}

function LogsPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="h-48 overflow-y-auto bg-black/40 rounded p-2 font-mono text-xs space-y-0.5">
      {logs.length === 0 && <div className="text-zinc-500">Немає логів</div>}
      {logs.map((l, i) => (
        <div
          key={i}
          className={
            l.level === "error" ? "text-red-400" :
            l.level === "warning" ? "text-amber-400" :
            "text-zinc-300"
          }
        >
          <span className="text-zinc-500 mr-2">{l.ts?.slice(11, 19)}</span>
          {l.message}
        </div>
      ))}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function MetaPage() {
  const [source, setSource] = useState("rada")
  const [dead, setDead] = useState("")
  const [q, setQ] = useState("")
  const [qInput, setQInput] = useState("")
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<MetaListResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const [status, setStatus] = useState<EnrichStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [textReport, setTextReport] = useState<TextReport | null>(null)
  const [textReportKind, setTextReportKind] = useState("missing")

  const LIMIT = 50

  // ── Fetch metadata list ──
  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ source, limit: String(LIMIT), offset: String(offset) })
      if (dead) params.set("dead", dead)
      if (q) params.set("q", q)
      const res = await fetch(`/api/admin/meta/list?${params}`)
      const json = await res.json()
      setData(json)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [source, dead, q, offset])

  useEffect(() => { fetchList() }, [fetchList])

  // ── Fetch enrich status ──
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/enrich/status")
      const json = await res.json()
      setStatus(json)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  // ── Actions ──
  async function startEnrich(force = false) {
    setStatusLoading(true)
    try {
      await fetch("/api/admin/enrich/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: [source === "rada" ? "rada" : "kmu"], force }),
      })
      await fetchStatus()
    } finally {
      setStatusLoading(false)
    }
  }

  async function stopEnrich() {
    await fetch("/api/admin/enrich/stop", { method: "POST" })
    await fetchStatus()
  }

  async function applyQdrant() {
    setStatusLoading(true)
    try {
      await fetch("/api/admin/enrich/qdrant/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: ["rada", "kmu"] }),
      })
      await fetchStatus()
    } finally {
      setStatusLoading(false)
    }
  }

  async function stopQdrant() {
    await fetch("/api/admin/enrich/qdrant/stop", { method: "POST" })
    await fetchStatus()
  }

  async function startTextExtraction(dryRun = true) {
    setStatusLoading(true)
    try {
      await fetch("/api/admin/enrich/text/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: ["rada", "kmu"], dry_run: dryRun }),
      })
      await fetchStatus()
    } finally {
      setStatusLoading(false)
    }
  }

  async function stopTextExtraction() {
    await fetch("/api/admin/enrich/text/stop", { method: "POST" })
    await fetchStatus()
  }

  async function loadTextReport(kind = textReportKind) {
    setTextReportKind(kind)
    const res = await fetch(`/api/admin/enrich/text/report?kind=${kind}&limit=20&offset=0`)
    const json = await res.json()
    setTextReport(json)
  }

  async function startMissingCheck() {
    setStatusLoading(true)
    try {
      await fetch("/api/admin/enrich/text/check-missing/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      await fetchStatus()
    } finally {
      setStatusLoading(false)
    }
  }

  async function stopMissingCheck() {
    await fetch("/api/admin/enrich/text/check-missing/stop", { method: "POST" })
    await fetchStatus()
  }

  const enrichRunning   = status?.enrich?.running ?? false
  const qdrantRunning   = status?.qdrant_meta?.running ?? false
  const textRunning     = status?.text_cancellations?.running ?? false
  const missingCheckRunning = status?.text_missing_check?.running ?? false
  const enrichState     = status?.enrich?.state ?? {}
  const qdrantState     = status?.qdrant_meta?.state ?? {}
  const textState       = status?.text_cancellations?.state ?? {}
  const missingCheckState = status?.text_missing_check?.state ?? {}

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] p-6 space-y-6">
      <h1 className="text-2xl font-bold text-[#C9A84C]">База метаданих документів</h1>

      {/* ── Enrich Control Panel ── */}
      <div className="bg-[#111827] rounded-xl border border-[#1e2a3a] p-5 space-y-4">
        <h2 className="text-lg font-semibold text-[#C9A84C]">Збагачення метаданих (OpenData API)</h2>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Enrich */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Фаза 1–3: отримання карток + запис .meta.json</span>
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${enrichRunning ? "bg-emerald-900/60 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                {enrichRunning ? "Виконується" : "Зупинено"}
              </span>
            </div>
            {"stats" in enrichState && (
              <div className="text-xs text-zinc-400">
                Збагачено: {(enrichState.stats as Record<string, number>)?.enriched ?? 0} | Помилок: {(enrichState.stats as Record<string, number>)?.errors ?? 0}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                disabled={enrichRunning || statusLoading}
                onClick={() => startEnrich(false)}
                className="px-3 py-1.5 bg-[#C9A84C] text-black rounded text-sm font-medium disabled:opacity-50"
              >
                Запустити
              </button>
              <button
                disabled={enrichRunning || statusLoading}
                onClick={() => startEnrich(true)}
                className="px-3 py-1.5 bg-amber-700 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Перезапустити (force)
              </button>
              <button
                disabled={!enrichRunning || statusLoading}
                onClick={stopEnrich}
                className="px-3 py-1.5 bg-red-800 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Зупинити
              </button>
            </div>
            <LogsPanel logs={status?.enrich?.live_logs ?? []} />
          </div>

          {/* Text cancellation extraction */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Text cancellations: evidence cache</span>
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${textRunning ? "bg-emerald-900/60 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                {textRunning ? "Running" : "Stopped"}
              </span>
            </div>
            <div className="text-xs text-zinc-400">
              full: {((textState.stats as Record<string, number> | undefined)?.full_high_hits ?? 0)}
              {" | "}partial: {((textState.stats as Record<string, number> | undefined)?.partial_hits ?? 0)}
              {" | "}missing: {((textState.stats as Record<string, number> | undefined)?.missing_locally ?? 0)}
              {" | "}unique: {((textState.unique_cancelled as number | undefined) ?? 0)}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                disabled={textRunning || statusLoading}
                onClick={() => startTextExtraction(true)}
                className="px-3 py-1.5 bg-amber-700 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Dry-run
              </button>
              <button
                disabled={textRunning || statusLoading}
                onClick={() => startTextExtraction(false)}
                className="px-3 py-1.5 bg-[#C9A84C] text-black rounded text-sm font-medium disabled:opacity-50"
              >
                Build cache
              </button>
              <button
                disabled={!textRunning || statusLoading}
                onClick={stopTextExtraction}
                className="px-3 py-1.5 bg-red-800 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Stop
              </button>
              <button
                disabled={textRunning || statusLoading}
                onClick={() => loadTextReport("missing")}
                className="px-3 py-1.5 bg-[#1e2a3a] text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Show missing
              </button>
              <button
                disabled={missingCheckRunning || statusLoading}
                onClick={startMissingCheck}
                className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Check OpenData
              </button>
              <button
                disabled={!missingCheckRunning || statusLoading}
                onClick={stopMissingCheck}
                className="px-3 py-1.5 bg-red-800 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Stop check
              </button>
              <button
                disabled={missingCheckRunning || statusLoading}
                onClick={() => loadTextReport("opendata")}
                className="px-3 py-1.5 bg-[#1e2a3a] text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Show checked
              </button>
            </div>
            <LogsPanel logs={status?.text_cancellations?.live_logs ?? []} />
            <LogsPanel logs={status?.text_missing_check?.live_logs ?? []} />
            <div className="text-xs text-zinc-400">
              OpenData found: {((missingCheckState.found_count as number | undefined) ?? 0)}
              {" | "}checked: {((missingCheckState.total_checked as number | undefined) ?? 0)}
              {" | "}not_found: {((missingCheckState.stats as Record<string, number> | undefined)?.not_found ?? 0)}
            </div>
          </div>

          {/* Qdrant patch */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400">Фаза 4: патч Qdrant payload (set_payload)</span>
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium ${qdrantRunning ? "bg-emerald-900/60 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                {qdrantRunning ? "Виконується" : "Зупинено"}
              </span>
            </div>
            {"stats" in qdrantState && (
              <div className="text-xs text-zinc-400">
                Оновлено точок: {(qdrantState.stats as Record<string, number>)?.updated_pts ?? 0} | Помилок: {(qdrantState.stats as Record<string, number>)?.errors ?? 0}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                disabled={qdrantRunning || statusLoading}
                onClick={applyQdrant}
                className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Застосувати до Qdrant
              </button>
              <button
                disabled={!qdrantRunning || statusLoading}
                onClick={stopQdrant}
                className="px-3 py-1.5 bg-red-800 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                Зупинити
              </button>
            </div>
            <LogsPanel logs={status?.qdrant_meta?.live_logs ?? []} />
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      {textReport && (
        <div className="bg-[#111827] rounded-xl border border-[#1e2a3a] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[#C9A84C]">
              Text report: {textReport.kind}
            </h2>
            <span className="text-sm text-zinc-400">
              {textReport.exists ? `shown ${textReport.items.length} / ${textReport.total}` : "report not found"}
            </span>
            <button
              onClick={() => loadTextReport(textReportKind)}
              className="ml-auto px-3 py-1.5 bg-[#1e2a3a] rounded text-sm"
            >
              Refresh
            </button>
          </div>
          <div className="text-xs text-zinc-400">
            unique: {(textReport.summary?.unique_nregs as number | undefined) ?? "—"}
            {" | "}found: {(textReport.summary?.found_count as number | undefined) ?? "—"}
            {" | "}generated: {(textReport.summary?.generated_at as string | undefined) ?? "—"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e2a3a] text-zinc-400">
                  <th className="px-2 py-1 text-left">nreg</th>
                  <th className="px-2 py-1 text-left">status</th>
                  <th className="px-2 py-1 text-left">by</th>
                  <th className="px-2 py-1 text-left">title / source</th>
                  <th className="px-2 py-1 text-left">evidence</th>
                </tr>
              </thead>
              <tbody>
                {textReport.items.map((item, idx) => (
                  <tr key={`${item.cancelled_nreg || item.nreg}-${idx}`} className="border-b border-[#1e2a3a]/50">
                    <td className="px-2 py-1 font-mono text-[#C9A84C] whitespace-nowrap">
                      {item.cancelled_nreg || item.nreg || "—"}
                    </td>
                    <td className="px-2 py-1 text-zinc-300 whitespace-nowrap">
                      {item.status || (item.mentions ? `${item.mentions} mentions` : "missing")}
                    </td>
                    <td className="px-2 py-1 font-mono text-zinc-300 whitespace-nowrap">{item.by || "—"}</td>
                    <td className="px-2 py-1 text-zinc-300 max-w-[280px]">
                      <div className="truncate" title={item.title || item.source_title}>
                        {item.title || item.source_title || "—"}
                      </div>
                    </td>
                    <td className="px-2 py-1 text-zinc-400 max-w-[520px]">
                      <div className="truncate" title={item.evidence}>{item.evidence || "—"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-[#111827] rounded-xl border border-[#1e2a3a] p-4 flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Джерело</label>
          <select
            value={source}
            onChange={e => { setSource(e.target.value); setOffset(0) }}
            className="bg-[#1e2a3a] border border-[#2a3a50] rounded px-2 py-1.5 text-sm"
          >
            <option value="rada">Рада (заkon.rada.gov.ua)</option>
            <option value="kmu">КМУ</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-zinc-400">Статус</label>
          <select
            value={dead}
            onChange={e => { setDead(e.target.value); setOffset(0) }}
            className="bg-[#1e2a3a] border border-[#2a3a50] rounded px-2 py-1.5 text-sm"
          >
            <option value="">Всі</option>
            <option value="false">Чинні</option>
            <option value="true">Втратили чинність</option>
          </select>
        </div>

        <div className="space-y-1 flex-1 min-w-[200px]">
          <label className="text-xs text-zinc-400">Пошук (назва або номер)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { setQ(qInput); setOffset(0) } }}
              placeholder="пошук..."
              className="flex-1 bg-[#1e2a3a] border border-[#2a3a50] rounded px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => { setQ(qInput); setOffset(0) }}
              className="px-3 py-1.5 bg-[#C9A84C] text-black rounded text-sm font-medium"
            >
              Знайти
            </button>
          </div>
        </div>

        <div className="text-sm text-zinc-400 self-end pb-1">
          {loading ? "Завантаження..." : `Знайдено: ${data?.total ?? 0}`}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-[#111827] rounded-xl border border-[#1e2a3a] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1e2a3a] text-zinc-400 text-xs">
              <th className="px-3 py-2 text-left">Номер</th>
              <th className="px-3 py-2 text-left">Назва</th>
              <th className="px-3 py-2 text-left">Тип</th>
              <th className="px-3 py-2 text-left">Статус</th>
              <th className="px-3 py-2 text-left">Прийнято</th>
              <th className="px-3 py-2 text-left">Редакція</th>
              <th className="px-3 py-2 text-left">Втратив</th>
              <th className="px-3 py-2 text-left">Тема</th>
              <th className="px-3 py-2 text-left">Орган</th>
              <th className="px-3 py-2 text-left">Ред.</th>
            </tr>
          </thead>
          <tbody>
            {!loading && data?.items.map((item) => (
              <tr key={item.nreg} className="border-b border-[#1e2a3a]/50 hover:bg-white/5 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-[#C9A84C]">
                  <a
                    href={item.url || `https://zakon.rada.gov.ua/laws/show/${item.nreg}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {item.nreg}
                  </a>
                </td>
                <td className="px-3 py-2 max-w-xs">
                  <div className="truncate text-xs" title={item.title}>{item.title || "—"}</div>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{item.doc_type || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusBadge item={item} />
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{item.adopted_date || "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{item.last_edition || "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap">{item.dead_since || "—"}</td>
                <td className="px-3 py-2 text-xs text-zinc-400 max-w-[120px]">
                  <div className="truncate" title={item.theme}>{item.theme || "—"}</div>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400 max-w-[100px]">
                  <div className="truncate" title={item.org}>{item.org || "—"}</div>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400 text-center">{item.editions_cnt || "—"}</td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">Завантаження...</td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                  {data?.total === 0 && !q && !dead
                    ? "Збагачених документів не знайдено. Спершу запустіть збагачення метаданих."
                    : "Документів не знайдено за вказаними фільтрами."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {data && data.total > LIMIT && (
        <div className="flex items-center gap-3 justify-center">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            className="px-4 py-1.5 bg-[#1e2a3a] rounded text-sm disabled:opacity-40"
          >
            ← Назад
          </button>
          <span className="text-sm text-zinc-400">
            {offset + 1}–{Math.min(offset + LIMIT, data.total)} з {data.total}
          </span>
          <button
            disabled={offset + LIMIT >= data.total}
            onClick={() => setOffset(offset + LIMIT)}
            className="px-4 py-1.5 bg-[#1e2a3a] rounded text-sm disabled:opacity-40"
          >
            Далі →
          </button>
        </div>
      )}
    </div>
  )
}
