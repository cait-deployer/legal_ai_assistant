"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Search, RefreshCw, Loader2, AlertCircle,
  LayoutGrid, Table2, Scale, BookOpen, X,
} from "lucide-react"
import { LawCard } from "../rada/law-card"
import { LawTable } from "../rada/law-table"
import { LawDetail } from "../rada/law-detail"
import type { Law } from "../rada/laws-list"

type DisplayMode = "cards" | "table"

const PER_PAGE_OPTIONS = [12, 25, 50, 100]

function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number
  totalPages: number
  onChange: (p: number) => void
}) {
  if (totalPages <= 1) return null

  const pages: (number | "…")[] = []
  const range = 2
  const start = Math.max(1, currentPage - range)
  const end = Math.min(totalPages, currentPage + range)

  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push("…")
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < totalPages) {
    if (end < totalPages - 1) pages.push("…")
    pages.push(totalPages)
  }

  return (
    <nav className="flex items-center gap-1">
      <Button
        variant="outline" size="sm"
        className="h-8 px-2.5 text-xs"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        ‹
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            variant={currentPage === p ? "default" : "outline"}
            size="sm"
            className="h-8 w-8 p-0 text-xs"
            onClick={() => onChange(p as number)}
          >
            {p}
          </Button>
        )
      )}
      <Button
        variant="outline" size="sm"
        className="h-8 px-2.5 text-xs"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        ›
      </Button>
    </nav>
  )
}

export function SupremeLawsListTab() {
  const [laws, setLaws] = useState<Law[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [search, setSearch] = useState("")
  const [displayMode, setDisplayMode] = useState<DisplayMode>("cards")
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(12)
  const [activeLaw, setActiveLaw] = useState<Law | null>(null)

  const fetchLaws = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/supreme/laws?per_page=2000&page=1", {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Не вдалося завантажити документи")
      const data = await res.json()
      setLaws(data.laws ?? [])
      setLastUpdated(new Date())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Помилка")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLaws() }, [fetchLaws])
  useEffect(() => { setCurrentPage(1) }, [search, itemsPerPage])
  useEffect(() => { setActiveLaw(null) }, [search])

  const filtered = useMemo(() => {
    if (!search.trim()) return laws
    const q = search.toLowerCase()
    return laws.filter((l) => {
      const m = l.metadata
      return (
        (m.source ?? "").toLowerCase().includes(q) ||
        (m.law_id ?? "").toLowerCase().includes(q)
      )
    })
  }, [laws, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filtered.slice(start, start + itemsPerPage)
  }, [filtered, currentPage, itemsPerPage])

  const handlePageChange = (p: number) => {
    if (p >= 1 && p <= totalPages) setCurrentPage(p)
  }

  const from = filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const to = Math.min(currentPage * itemsPerPage, filtered.length)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── left panel ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* ── top: fixed header ── */}
        <div className="shrink-0 pt-6 pb-3 space-y-4 border-b border-border bg-background">

          {/* stats badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="px-3 py-1.5 text-sm rounded-lg font-medium">
              {laws.length} документів
            </Badge>
            {search && (
              <Badge variant="outline" className="px-3 py-1.5 text-sm rounded-lg">
                {filtered.length} знайдено
              </Badge>
            )}
          </div>

          {/* toolbar */}
          <div className="flex gap-3 items-center flex-wrap">
            {/* search */}
            <div className="relative flex-1 min-w-[200px] h-10">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Пошук за назвою або ID..."
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 !h-10 py-1"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* view toggle */}
            <div className="hidden sm:flex rounded-lg border border-border overflow-hidden shrink-0">
              <Button
                variant={displayMode === "cards" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none h-10 px-3 gap-1.5 border-r border-border"
                onClick={() => setDisplayMode("cards")}
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden md:inline">Картки</span>
              </Button>
              <Button
                variant={displayMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none h-10 px-3 gap-1.5"
                onClick={() => setDisplayMode("table")}
              >
                <Table2 className="w-4 h-4" />
                <span className="hidden md:inline">Таблиця</span>
              </Button>
            </div>

            {/* refresh */}
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <Button
                variant="outline"
                onClick={fetchLaws}
                disabled={loading}
                className="gap-2 h-10"
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />}
                <span className="hidden sm:inline">Оновити</span>
              </Button>
              {lastUpdated && (
                <p className="text-[11px] text-muted-foreground hidden sm:block whitespace-nowrap">
                  {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>

          {/* error */}
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
              <Button variant="ghost" size="sm" onClick={fetchLaws} className="ml-auto">
                Повторити
              </Button>
            </div>
          )}
        </div>

        {/* ── middle: scrollable content ── */}
        <div className="flex-1 overflow-y-auto py-4">

          {loading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-56 rounded-xl bg-muted/50 animate-pulse"
                  style={{ animationDelay: `${i * 70}ms` }}
                />
              ))}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center gap-4">
              <div className="p-5 bg-muted/50 rounded-2xl">
                <BookOpen className="w-12 h-12 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {search ? "Нічого не знайдено" : "Документи відсутні"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {search
                    ? "Спробуйте інший запит."
                    : "Запустіть синхронізацію на вкладці «Налаштування»."}
                </p>
              </div>
              {search && (
                <Button variant="outline" onClick={() => setSearch("")} className="gap-2">
                  <X className="w-4 h-4" /> Скинути пошук
                </Button>
              )}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <>
              <div className="sm:hidden grid gap-4">
                {paginated.map((law) => (
                  <LawCard
                    key={law.id}
                    law={law}
                    isActive={activeLaw?.id === law.id}
                    onOpen={() => setActiveLaw((prev) => prev?.id === law.id ? null : law)}
                  />
                ))}
              </div>

              <div className="hidden sm:block">
                {displayMode === "cards" ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {paginated.map((law) => (
                      <LawCard
                        key={law.id}
                        law={law}
                        isActive={activeLaw?.id === law.id}
                        onOpen={() => setActiveLaw((prev) => prev?.id === law.id ? null : law)}
                      />
                    ))}
                  </div>
                ) : (
                  <LawTable
                    laws={paginated}
                    activeId={activeLaw?.id}
                    onOpen={(law) => setActiveLaw((prev) => prev?.id === law.id ? null : law)}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* ── bottom: pinned pagination ── */}
        {!loading && !error && filtered.length > 0 && (
          <div className="shrink-0 border-t border-border bg-muted/20 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground text-center sm:text-left">
                Показано{" "}
                <span className="font-semibold text-foreground">{from}–{to}</span>
                {" "}з{" "}
                <span className="font-semibold text-foreground">{filtered.length}</span>
                {" "}документів
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">На сторінці</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1) }}
                    className="h-8 w-[70px] text-sm rounded-md border border-border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {PER_PAGE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div className="hidden sm:block w-px h-5 bg-border" />
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onChange={handlePageChange}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── right panel: detail ── */}
      {activeLaw && (
        <div className="w-[380px] shrink-0 border-l border-border overflow-y-auto bg-card mt-6">
          <LawDetail
            law={activeLaw}
            onClose={() => setActiveLaw(null)}
            textApiPath="/api/admin/supreme/laws/text"
          />
        </div>
      )}
    </div>
  )
}