"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Search, RefreshCw, Loader2, AlertCircle,
  LayoutGrid, Table2, BookOpen, X, FileText, Hash,
  ExternalLink, Calendar, Layers, Filter, ChevronDown,
  Maximize2, Minimize2,
} from "lucide-react"
import { LawCard } from "../rada/law-card"
import { LawTable } from "../rada/law-table"
import type { Law } from "../rada/laws-list"

function getSourceLabel(law_id: string) {
  if ((law_id ?? "").startsWith("sc_")) return "Верховний Суд"
  if ((law_id ?? "").startsWith("wiki_")) return "Wiki"
  return "РАДА"
}

function getSourceStyle(law_id: string) {
  if ((law_id ?? "").startsWith("sc_"))
    return "bg-purple-500/10 text-purple-400 border-purple-500/20"
  if ((law_id ?? "").startsWith("wiki_"))
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
  return "bg-blue-500/10 text-blue-400 border-blue-500/20"
}

// ── Constants ──────────────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { value: "", label: "Всі джерела" },
  { value: "rada", label: "РАДА" },
  { value: "court", label: "Верховний Суд" },
  { value: "wiki", label: "Wiki" },
]

// Маппінг кодів розділів Ради → читабельні назви
const SECTION_LABELS: Record<string, string> = {
  h1:  "Господарсько-процесуальне законодавство",
  h2:  "Банки, фінанси, кредит, бюджет",
  h3:  "Бухгалтерський облік, оподаткування, аудит",
  h4:  "Державний та суспільний устрій",
  h5:  "Цивільне та цивільно-процесуальне законодавство",
  h6:  "Житлове законодавство",
  h7:  "Транспорт, зв'язок, інформація",
  h8:  "Законодавство про адмін. відповідальність",
  h9:  "Природні ресурси, охорона довкілля",
  h10: "Ліцензування, сертифікація, патентування",
  h11: "Міжнародні відносини",
  h12: "Наука, освіта, культура",
  h13: "Нотаріат, адвокатура",
  h14: "Охорона, безпека, правопорядок",
  h15: "Підприємства та підприємницька діяльність",
  h16: "Охорона здоров'я, сім'я, молодь, спорт",
  h17: "Промисловість, паливно-енергетичний комплекс",
  h18: "Сільське господарство",
  h19: "Трудові відносини, зайнятість населення",
  h20: "Соціальне забезпечення, страхування",
  h21: "Будівництво, капітальний ремонт, архітектура",
  h22: "Суд, прокуратура, юстиція",
  h23: "Митна діяльність, ЗЕД",
  h24: "Торгівля, громадське харчування",
  h25: "Кримінальне та кримінально-процесуальне законодавство",
  h26: "Цінні папери, фондовий ринок",
  h27: "Кадрові питання. Нагородження",
  h28: "Регіональне законодавство",
  h29: "Проекти. Внесення змін",
  h30: "Судова практика (РАДА)",
  h31: "Загальні засади правового регулювання економіки",
  h32: "Ядерне законодавство",
}

// Повертає читабельну назву категорії (або оригінал якщо вже читабельна)
export function categoryLabel(cat: string): string {
  if (!cat) return "—"
  return SECTION_LABELS[cat.toLowerCase()] ?? cat
}

const PER_PAGE_OPTIONS = [12, 25, 50, 100]

// ── Pagination ─────────────────────────────────────────────────────────────
function Pagination({ currentPage, totalPages, onChange }: {
  currentPage: number; totalPages: number; onChange: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const pages: (number | "…")[] = []
  const range = 2
  const start = Math.max(1, currentPage - range)
  const end = Math.min(totalPages, currentPage + range)
  if (start > 1) { pages.push(1); if (start > 2) pages.push("…") }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) { if (end < totalPages - 1) pages.push("…"); pages.push(totalPages) }
  return (
    <nav className="flex items-center gap-1">
      <button
        className="h-8 px-2.5 text-xs rounded-lg border border-[#BFA071]/20 text-[#BFA071]/50 hover:border-[#BFA071]/40 hover:text-[#BFA071] hover:bg-[#BFA071]/5 disabled:opacity-30 transition-all"
        onClick={() => onChange(currentPage - 1)} disabled={currentPage === 1}
      >‹</button>
      {pages.map((p, i) => p === "…"
        ? <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-[#BFA071]/50">…</span>
        : <button
          key={p}
          className={`h-8 w-8 text-xs rounded-lg border transition-all ${currentPage === p
            ? "bg-[#BFA071] border-[#BFA071] text-[#0A0E1A] font-bold"
            : "border-[#BFA071]/20 text-[#BFA071]/50 hover:border-[#BFA071]/40 hover:text-[#BFA071] hover:bg-[#BFA071]/5"
            }`}
          onClick={() => onChange(p as number)}
        >{p}</button>
      )}
      <button
        className="h-8 px-2.5 text-xs rounded-lg border border-[#BFA071]/20 text-[#BFA071]/50 hover:border-[#BFA071]/40 hover:text-[#BFA071] hover:bg-[#BFA071]/5 disabled:opacity-30 transition-all"
        onClick={() => onChange(currentPage + 1)} disabled={currentPage === totalPages}
      >›</button>
    </nav>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────
function DocDetailContent({
  law, full, loading, error, expanded, onClose, onToggleExpand,
}: {
  law: Law
  full: { full_text: string; chunk_count: number } | null
  loading: boolean
  error: string | null
  expanded: boolean
  onClose: () => void
  onToggleExpand: () => void
}) {
  const meta = law.metadata
  const scrapedAt = meta.scraped_at
    ? new Date(meta.scraped_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "long", year: "numeric" })
    : null

  return (
    <div className={`flex flex-col h-full bg-[#0d1120] ${expanded ? "rounded-[2rem] overflow-hidden" : ""}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#BFA071]/10 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#BFA071]/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-[#BFA071]" />
            </div>
            <p className={`font-semibold leading-snug min-w-0 text-[#E0E6ED] ${expanded ? "text-base line-clamp-1" : "text-sm line-clamp-2"}`}>
              {meta.source || `Документ ${meta.law_id}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#BFA071]/50 hover:text-[#BFA071] hover:bg-[#BFA071]/10 transition-colors"
              onClick={onToggleExpand}
              title={expanded ? "Згорнути" : "Розгорнути"}
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              className="h-7 w-7 rounded-lg flex items-center justify-center text-[#BFA071]/70 hover:text-[#BFA071] hover:bg-[#BFA071]/10 transition-colors"
              onClick={onClose}
              title="Закрити"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border ${getSourceStyle(meta.law_id)}`}>
            {getSourceLabel(meta.law_id)}
          </span>
          {meta.category && (
            <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border bg-[#BFA071]/5 text-[#BFA071]/50 border-[#BFA071]/10">
              {meta.category}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className={`flex-1 overflow-y-auto px-5 py-4 min-h-0 ${expanded ? "flex gap-8" : "space-y-4"}`}>
        {/* Metadata column */}
        <div className={`space-y-3 ${expanded ? "w-64 shrink-0" : ""}`}>
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#BFA071]/10 flex items-center justify-center shrink-0">
              <Hash className="w-3.5 h-3.5 text-[#BFA071]/50" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider">ID</p>
              <p className="text-xs mt-0.5 font-mono break-all text-[#E0E6ED]/70">{meta.law_id}</p>
            </div>
          </div>
          {scrapedAt && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#BFA071]/10 flex items-center justify-center shrink-0">
                <Calendar className="w-3.5 h-3.5 text-[#BFA071]/50" />
              </div>
              <div>
                <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider">Завантажено</p>
                <p className="text-xs mt-0.5 text-[#E0E6ED]/70">{scrapedAt}</p>
              </div>
            </div>
          )}
          {full?.chunk_count != null && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#BFA071]/10 flex items-center justify-center shrink-0">
                <Layers className="w-3.5 h-3.5 text-[#BFA071]/50" />
              </div>
              <div>
                <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider">Частин тексту</p>
                <p className="text-xs mt-0.5 text-[#E0E6ED]/70">{full.chunk_count}</p>
              </div>
            </div>
          )}
          {meta.law_url && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#BFA071]/10 flex items-center justify-center shrink-0">
                <ExternalLink className="w-3.5 h-3.5 text-[#BFA071]/50" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-wider">Джерело</p>
                <a href={meta.law_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs mt-0.5 text-[#BFA071] hover:text-[#d4b78a] hover:underline underline-offset-2 flex items-center gap-1 break-all transition-colors">
                  {(() => { try { return new URL(meta.law_url).hostname } catch { return meta.law_url } })()}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            </div>
          )}

          {!expanded && <div className="h-px bg-[#BFA071]/10" />}
        </div>

        {/* Divider (expanded horizontal layout) */}
        {expanded && <div className="w-px bg-[#BFA071]/10 shrink-0" />}

        {/* Full text column */}
        <div className={`space-y-2 ${expanded ? "flex-1 min-w-0" : ""}`}>
          <p className="text-[10px] font-black uppercase tracking-wider text-[#BFA071]/70 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Повний текст
          </p>
          {loading && (
            <div className="space-y-2 pt-1">
              {Array.from({ length: expanded ? 12 : 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 rounded bg-[#BFA071]/5" style={{ width: `${80 + (i % 4) * 5}%` }} />
              ))}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 rounded-xl p-3 border border-red-500/20">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && full?.full_text && (
            <div className={`bg-[#0A0E1A]/80 rounded-xl border border-[#BFA071]/10 p-4 text-xs leading-relaxed text-[#E0E6ED]/60 whitespace-pre-wrap font-mono overflow-y-auto ${expanded ? "h-full max-h-[calc(100%-2rem)]" : "max-h-[50vh]"}`}>
              {full.full_text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DocDetail({ law, onClose }: { law: Law; onClose: () => void }) {
  const [full, setFull] = useState<{ full_text: string; chunk_count: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const meta = law.metadata

  const textApiPath = (meta.law_id ?? "").startsWith("sc_")
    ? "/api/admin/supreme/laws/text"
    : "/api/admin/rada/laws/text"

  useEffect(() => {
    setLoading(true); setError(null); setFull(null)
    fetch(`${textApiPath}?law_id=${encodeURIComponent(meta.law_id)}`)
      .then((r) => { if (!r.ok) throw new Error(`Помилка ${r.status}`); return r.json() })
      .then(setFull)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [meta.law_id, textApiPath])

  // Close expanded on ESC
  useEffect(() => {
    if (!expanded) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false) }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [expanded])

  const sharedProps = { law, full, loading, error, expanded, onClose, onToggleExpand: () => setExpanded((v) => !v) }

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        />
        {/* Modal panel */}
        <div className="relative w-full max-w-5xl h-[90vh] shadow-2xl shadow-black/60 ring-1 ring-[#BFA071]/20 rounded-[2rem] overflow-hidden">
          <DocDetailContent {...sharedProps} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1120]">
      <DocDetailContent {...sharedProps} />
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BasePage() {
  const [docs, setDocs] = useState<Law[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(25)

  const [displayMode, setDisplayMode] = useState<"cards" | "table">("table")
  const [activeDoc, setActiveDoc] = useState<Law | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(val)
      setCurrentPage(1)
    }, 400)
  }

  useEffect(() => { setCurrentPage(1) }, [sourceFilter, categoryFilter, itemsPerPage])
  useEffect(() => { setActiveDoc(null) }, [search, sourceFilter, categoryFilter])

  const fetchDocs = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        per_page: String(itemsPerPage),
      })
      if (search) params.set("search", search)
      if (sourceFilter) params.set("source", sourceFilter)
      if (categoryFilter) params.set("category", categoryFilter)

      const res = await fetch(`/api/admin/base/docs?${params}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Не вдалося завантажити документи")
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDocs((data.docs ?? []).map((doc: any) => ({
        id: doc.id,
        content: "",
        metadata: {
          law_id: doc.law_id ?? "",
          source: doc.title ?? "",
          status: doc.status ?? "",
          law_url: doc.law_url ?? "",
          category: doc.category ?? "",
          chunk_index: 0,
          scraped_at: doc.scraped_at,
          source_domain: doc.source_domain,
        },
      })))
      setTotal(data.total ?? 0)
      setTotalPages(Math.ceil((data.total ?? 0) / itemsPerPage) || 1)
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Помилка")
    } finally {
      setLoading(false)
    }
  }, [search, sourceFilter, categoryFilter, currentPage, itemsPerPage])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  useEffect(() => {
    fetch("/api/admin/base/categories")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCategoryOptions(data) })
      .catch(() => {})
  }, [])

  const hasFilters = searchInput || sourceFilter || categoryFilter
  const from = total === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const to = Math.min(currentPage * itemsPerPage, total)

  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setSourceFilter("")
    setCategoryFilter("")
    setCurrentPage(1)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#BFA071]/10 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#BFA071]/10 border border-[#BFA071]/20 rounded-2xl shrink-0">
            <BookOpen className="w-8 h-8 text-[#BFA071]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">База знань</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Всі документи з усіх джерел</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && <span className="text-[10px] font-black text-[#BFA071]/50 uppercase tracking-widest hidden sm:block">{lastUpdated.toLocaleTimeString()}</span>}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchDocs()}
            disabled={loading}
            className="gap-2 border border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити
          </Button>
        </div>
      </div>

      <div className="flex h-full overflow-hidden">
        {/* Left panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Sticky toolbar */}
          <div className="shrink-0 pt-5 pb-3 space-y-3 border-b border-[#BFA071]/10">

            {/* Total info */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="inline-flex items-center px-3 py-1.5 text-sm rounded-xl bg-[#BFA071]/10 border border-[#BFA071]/20 text-[#BFA071] font-semibold">
                {total.toLocaleString()} документів
              </span>
              {hasFilters && !loading && (
                <span className="inline-flex items-center px-3 py-1.5 text-sm rounded-xl bg-[#0d1120] border border-[#BFA071]/10 text-[#E0E6ED]/70">
                  {total} знайдено
                </span>
              )}
              {loading && (
                <Loader2 className="w-4 h-4 animate-spin text-[#BFA071]/70" />
              )}
            </div>

            {/* Search + filters + view toggle */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] h-10">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#BFA071]/50 pointer-events-none" />
                <Input
                  placeholder="Пошук за назвою або ID документа..."
                  type="search"
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="pl-9 h-10 bg-[#0d1120] border-[#BFA071]/20 rounded-xl text-[#E0E6ED] placeholder:text-[#BFA071]/20 focus-visible:border-[#BFA071]/40 focus-visible:ring-0"
                />
                {searchInput && (
                  <button onClick={() => { setSearchInput(""); setSearch(""); setCurrentPage(1) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#BFA071]/50 hover:text-[#BFA071] transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Source filter */}
              <div className="relative h-10 shrink-0">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BFA071]/50 pointer-events-none" />
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
                  className="h-10 pl-8 pr-7 text-sm rounded-xl border border-[#BFA071]/20 bg-[#0d1120] text-[#E0E6ED] focus:outline-none focus:border-[#BFA071]/40 appearance-none cursor-pointer">
                  {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BFA071]/50 pointer-events-none" />
              </div>

              {/* Category filter */}
              {categoryOptions.length > 0 && (
                <div className="relative h-10 shrink-0">
                  <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BFA071]/50 pointer-events-none" />
                  <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-10 pl-8 pr-7 text-sm rounded-xl border border-[#BFA071]/20 bg-[#0d1120] text-[#E0E6ED] focus:outline-none focus:border-[#BFA071]/40 appearance-none cursor-pointer">
                    <option value="">Всі категорії</option>
                    {categoryOptions.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#BFA071]/50 pointer-events-none" />
                </div>
              )}

              {/* Clear */}
              {hasFilters && (
                <button
                  className="h-10 px-3 flex items-center gap-1.5 text-xs text-[#BFA071]/70 hover:text-[#BFA071] shrink-0 transition-colors"
                  onClick={clearFilters}
                >
                  <X className="w-3.5 h-3.5" /> Скинути
                </button>
              )}

              {/* View toggle */}
              <div className="hidden sm:flex rounded-xl border border-[#BFA071]/20 overflow-hidden shrink-0">
                <button
                  className={`h-10 px-3 flex items-center gap-1.5 text-xs transition-colors border-r border-[#BFA071]/20 ${displayMode === "cards" ? "bg-[#BFA071]/10 text-[#BFA071]" : "text-[#BFA071]/70 hover:text-[#BFA071] hover:bg-[#BFA071]/5"}`}
                  onClick={() => setDisplayMode("cards")}
                >
                  <LayoutGrid className="w-4 h-4" /><span className="hidden md:inline">Картки</span>
                </button>
                <button
                  className={`h-10 px-3 flex items-center gap-1.5 text-xs transition-colors ${displayMode === "table" ? "bg-[#BFA071]/10 text-[#BFA071]" : "text-[#BFA071]/70 hover:text-[#BFA071] hover:bg-[#BFA071]/5"}`}
                  onClick={() => setDisplayMode("table")}
                >
                  <Table2 className="w-4 h-4" /><span className="hidden md:inline">Таблиця</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
                <button className="ml-auto text-xs text-red-400 hover:text-red-300 transition-colors" onClick={() => fetchDocs()}>Повторити</button>
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto py-4">
            {loading && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-48 rounded-2xl bg-[#BFA071]/5 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
                ))}
              </div>
            )}

            {!loading && !error && docs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center gap-4">
                <div className="p-5 bg-[#BFA071]/5 rounded-2xl border border-[#BFA071]/10">
                  <BookOpen className="w-12 h-12 text-[#BFA071]/20" />
                </div>
                <div>
                  <p className="text-lg font-serif font-bold text-white">{hasFilters ? "Нічого не знайдено" : "База порожня"}</p>
                  <p className="text-sm text-[#E0E6ED]/70 mt-1">
                    {hasFilters ? "Спробуйте змінити фільтри." : "Запустіть синхронізацію на сторінці Налаштувань."}
                  </p>
                </div>
                {hasFilters && (
                  <button
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#BFA071]/20 text-[#BFA071]/60 hover:text-[#BFA071] hover:border-[#BFA071]/40 text-sm transition-colors"
                    onClick={clearFilters}
                  >
                    <X className="w-4 h-4" /> Скинути фільтри
                  </button>
                )}
              </div>
            )}

            {!loading && !error && docs.length > 0 && (
              <>
                <div className="sm:hidden grid gap-4">
                  {docs.map((doc) => (
                    <LawCard key={doc.id} law={doc} isActive={activeDoc?.id === doc.id}
                      onOpen={() => setActiveDoc((p) => p?.id === doc.id ? null : doc)} />
                  ))}
                </div>
                <div className="hidden sm:block">
                  {displayMode === "cards" ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {docs.map((doc) => (
                        <LawCard key={doc.id} law={doc} isActive={activeDoc?.id === doc.id}
                          onOpen={() => setActiveDoc((p) => p?.id === doc.id ? null : doc)} />
                      ))}
                    </div>
                  ) : (
                    <LawTable laws={docs} activeId={activeDoc?.id}
                      onOpen={(doc) => setActiveDoc((p) => p?.id === doc.id ? null : doc)} />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Pinned pagination */}
          {!loading && !error && total > 0 && (
            <div className="shrink-0 border-t border-[#BFA071]/10 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[#E0E6ED]/70 text-center sm:text-left">
                  Показано{" "}
                  <span className="font-semibold text-[#BFA071]">{from}–{to}</span>
                  {" "}з{" "}
                  <span className="font-semibold text-[#BFA071]">{total.toLocaleString()}</span>
                  {" "}документів
                </p>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#E0E6ED]/70 whitespace-nowrap">На сторінці</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className="h-8 w-[70px] text-xs rounded-xl border border-[#BFA071]/20 bg-[#0d1120] text-[#E0E6ED] px-2 focus:outline-none focus:border-[#BFA071]/40"
                    >
                      {PER_PAGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div className="hidden sm:block w-px h-5 bg-[#BFA071]/10" />
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onChange={setCurrentPage}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right detail panel */}
        {activeDoc && (
          <div className="w-[380px] shrink-0 border-l border-[#BFA071]/10 overflow-y-auto mt-5">
            <DocDetail law={activeDoc} onClose={() => setActiveDoc(null)} />
          </div>
        )}
      </div>
    </div>
  )
}
