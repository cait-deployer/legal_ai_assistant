"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Search, RefreshCw, Loader2, AlertCircle,
  LayoutGrid, Table2, BookOpen, X, Database,
  Scale, FileText, Hash, ExternalLink, Calendar, Layers,
  Filter, ChevronDown,
} from "lucide-react"
import { LawCard } from "../rada/law-card"
import { LawTable } from "../rada/law-table"
import type { Law } from "../rada/laws-list"

// ── Constants ──────────────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { value: "", label: "Всі джерела" },
  { value: "rada", label: "РАДА" },
  { value: "supreme", label: "Верховний Суд" },
  { value: "wiki", label: "Wiki" },
]

const CATEGORY_OPTIONS = [
  { value: "", label: "Всі категорії" },
  { value: "Судова практика", label: "Судова практика" },
  { value: "Роз'яснення та шаблони", label: "Роз'яснення" },
  { value: "h14", label: "Збройні сили" },
  { value: "h25", label: "Кримінальне право" },
  { value: "h19", label: "Трудові відносини" },
  { value: "h20", label: "Соціальний захист" },
]

const PER_PAGE_OPTIONS = [12, 25, 50, 100]

function getSourceLabel(law_id: string) {
  if ((law_id ?? "").startsWith("sc_")) return "Верховний Суд"
  if ((law_id ?? "").startsWith("wiki_")) return "Wiki"
  return "РАДА"
}

function getSourceStyle(law_id: string) {
  if ((law_id ?? "").startsWith("sc_"))
    return "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800"
  if ((law_id ?? "").startsWith("wiki_"))
    return "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
  return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"
}

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
      <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => onChange(currentPage - 1)} disabled={currentPage === 1}>‹</Button>
      {pages.map((p, i) => p === "…"
        ? <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
        : <Button key={p} variant={currentPage === p ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => onChange(p as number)}>{p}</Button>
      )}
      <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => onChange(currentPage + 1)} disabled={currentPage === totalPages}>›</Button>
    </nav>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────
function DocDetail({ law, onClose }: { law: Law; onClose: () => void }) {
  const [full, setFull] = useState<{ full_text: string; chunk_count: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  const scrapedAt = meta.scraped_at
    ? new Date(meta.scraped_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "long", year: "numeric" })
    : null

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <p className="font-semibold text-sm leading-snug line-clamp-2 min-w-0">
              {meta.source || `Документ ${meta.law_id}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${getSourceStyle(meta.law_id)}`}>
            {getSourceLabel(meta.law_id)}
          </span>
          {meta.category && (
            <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border">
              {meta.category}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">ID</p>
              <p className="text-sm mt-0.5 font-mono break-all">{meta.law_id}</p>
            </div>
          </div>
          {scrapedAt && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Завантажено</p>
                <p className="text-sm mt-0.5">{scrapedAt}</p>
              </div>
            </div>
          )}
          {full?.chunk_count != null && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Частин тексту</p>
                <p className="text-sm mt-0.5">{full.chunk_count}</p>
              </div>
            </div>
          )}
          {meta.law_url && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Джерело</p>
                <a href={meta.law_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm mt-0.5 text-primary hover:underline underline-offset-2 flex items-center gap-1 break-all">
                  {(() => { try { return new URL(meta.law_url).hostname } catch { return meta.law_url } })()}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Повний текст
          </p>
          {loading && (
            <div className="space-y-2 pt-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 rounded" style={{ width: `${80 + (i % 4) * 5}%` }} />
              ))}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && full?.full_text && (
            <div className="bg-muted/30 rounded-xl border p-4 text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono max-h-[50vh] overflow-y-auto">
              {full.full_text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BasePage() {
  // Server-driven state
  const [docs, setDocs] = useState<Law[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Filter / pagination params — sent to backend on every change
  const [searchInput, setSearchInput] = useState("")   // raw input (debounced)
  const [search, setSearch] = useState("")             // debounced value sent to API
  const [sourceFilter, setSourceFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(25)

  // UI state
  const [displayMode, setDisplayMode] = useState<"cards" | "table">("table")
  const [activeDoc, setActiveDoc] = useState<Law | null>(null)

  // Debounce search input 400ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchInput = (val: string) => {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(val)
      setCurrentPage(1)
    }, 400)
  }

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1) }, [sourceFilter, categoryFilter, itemsPerPage])
  // Close detail when filters change
  useEffect(() => { setActiveDoc(null) }, [search, sourceFilter, categoryFilter])

  // Fetch from backend — triggered by any param change
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
      setDocs(data.docs ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.total_pages ?? 1)
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Помилка")
    } finally {
      setLoading(false)
    }
  }, [search, sourceFilter, categoryFilter, currentPage, itemsPerPage])

  useEffect(() => { fetchDocs() }, [fetchDocs])

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b-2 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl shrink-0">
            <BookOpen className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">База знань</h1>
            <p className="text-lg text-muted-foreground mt-1">Всі документи з усіх джерел</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && <span className="text-xs text-muted-foreground hidden sm:block">{lastUpdated.toLocaleTimeString()}</span>}
          <Button variant="outline" size="sm" onClick={() => fetchDocs()} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити
          </Button>
        </div>
      </div>

      <div className="flex h-full overflow-hidden">
        {/* Left panel */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Sticky toolbar */}
          <div className="shrink-0 pt-5 pb-3 space-y-3 border-b border-border bg-background">

            {/* Total info */}
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="secondary" className="px-3 py-1.5 text-sm rounded-lg font-medium">
                {total.toLocaleString()} документів
              </Badge>
              {hasFilters && !loading && (
                <Badge variant="outline" className="px-3 py-1.5 text-sm rounded-lg">
                  {total} знайдено
                </Badge>
              )}
              {loading && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Search + filters + view toggle */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] h-10">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Пошук за назвою або ID документа..."
                  type="search"
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="pl-9 !h-10"
                />
                {searchInput && (
                  <button onClick={() => { setSearchInput(""); setSearch(""); setCurrentPage(1) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Source filter */}
              <div className="relative h-10 shrink-0">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
                  className="h-10 pl-8 pr-7 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer">
                  {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {/* Category filter */}
              <div className="relative h-10 shrink-0">
                <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-10 pl-8 pr-7 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer">
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {/* Clear */}
              {hasFilters && (
                <Button variant="ghost" size="sm" className="h-10 gap-1.5 text-muted-foreground shrink-0" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5" /> Скинути
                </Button>
              )}

              {/* View toggle */}
              <div className="hidden sm:flex rounded-lg border border-border overflow-hidden shrink-0">
                <Button variant={displayMode === "cards" ? "secondary" : "ghost"} size="sm"
                  className="rounded-none h-10 px-3 gap-1.5 border-r border-border" onClick={() => setDisplayMode("cards")}>
                  <LayoutGrid className="w-4 h-4" /><span className="hidden md:inline">Картки</span>
                </Button>
                <Button variant={displayMode === "table" ? "secondary" : "ghost"} size="sm"
                  className="rounded-none h-10 px-3 gap-1.5" onClick={() => setDisplayMode("table")}>
                  <Table2 className="w-4 h-4" /><span className="hidden md:inline">Таблиця</span>
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-medium">{error}</p>
                <Button variant="ghost" size="sm" onClick={() => fetchDocs()} className="ml-auto">Повторити</Button>
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto py-4">
            {loading && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-48 rounded-xl bg-muted/50 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
                ))}
              </div>
            )}

            {!loading && !error && docs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center gap-4">
                <div className="p-5 bg-muted/50 rounded-2xl">
                  <BookOpen className="w-12 h-12 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{hasFilters ? "Нічого не знайдено" : "База порожня"}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {hasFilters ? "Спробуйте змінити фільтри." : "Запустіть синхронізацію на сторінці Налаштувань."}
                  </p>
                </div>
                {hasFilters && (
                  <Button variant="outline" onClick={clearFilters} className="gap-2">
                    <X className="w-4 h-4" /> Скинути фільтри
                  </Button>
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
            <div className="shrink-0 border-t border-border bg-muted/20 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground text-center sm:text-left">
                  Показано{" "}
                  <span className="font-semibold text-foreground">{from}–{to}</span>
                  {" "}з{" "}
                  <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
                  {" "}документів
                </p>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">На сторінці</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => setItemsPerPage(Number(e.target.value))}
                      className="h-8 w-[70px] text-sm rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {PER_PAGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div className="hidden sm:block w-px h-5 bg-border" />
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
          <div className="w-[380px] shrink-0 border-l border-border overflow-y-auto bg-card mt-5">
            <DocDetail law={activeDoc} onClose={() => setActiveDoc(null)} />
          </div>
        )}
      </div>
    </div>
  )
}