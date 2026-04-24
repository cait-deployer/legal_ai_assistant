"use client"

import { useState, useEffect, useCallback } from "react"

// ── Types ──────────────────────────────────────────────────────────────────────

type DiskSourceStat = {
  files: number
  size_mb: number
  recent: { law_id: string; size_kb: number; title: string; mtime: string }[]
}

type DiskState = {
  sources: Record<string, DiskSourceStat>
  total_mb: number
}

type LawPreview = {
  law_id: string
  source: string
  meta: Record<string, unknown>
  text: string
  size_kb: number
  chars: number
}

type FileEntry = { law_id: string; source: string; title: string; size_kb: number; mtime: string }

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DiskPage() {
  const [disk, setDisk] = useState<DiskState | null>(null)
  const [diskLoading, setDiskLoading] = useState(false)

  const [files, setFiles] = useState<FileEntry[]>([])
  const [total, setTotal] = useState(0)
  const [filesLoading, setFilesLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [sortBy, setSortBy] = useState("mtime")
  const [order, setOrder] = useState("desc")
  const [offset, setOffset] = useState(0)
  const PAGE_SIZE = 50

  const [preview, setPreview] = useState<LawPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")

  const fetchDisk = useCallback(async () => {
    setDiskLoading(true)
    try {
      const res = await fetch("/api/admin/v2/disk")
      if (res.ok) setDisk(await res.json())
    } catch { /* ignore */ }
    setDiskLoading(false)
  }, [])

  const fetchFiles = useCallback(async (off = 0, s = search, src = filterSource, sb = sortBy, ord = order) => {
    setFilesLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off), sort_by: sb, order: ord })
      if (s) params.set("search", s)
      if (src) params.set("source", src)
      const res = await fetch(`/api/admin/v2/disk/files?${params}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files ?? [])
        setTotal(data.total ?? 0)
      }
    } catch { /* ignore */ }
    setFilesLoading(false)
  }, [search, filterSource, sortBy, order])

  useEffect(() => {
    fetchDisk()
    fetchFiles(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch() {
    setOffset(0)
    fetchFiles(0, search, filterSource, sortBy, order)
  }

  async function handlePreview(source: string, law_id: string) {
    setPreviewLoading(true)
    setPreviewError("")
    setPreview(null)
    try {
      const res = await fetch(`/api/admin/v2/disk/law?source=${source}&law_id=${encodeURIComponent(law_id)}`)
      if (res.ok) {
        setPreview(await res.json())
        setTimeout(() => document.getElementById("law-preview")?.scrollIntoView({ behavior: "smooth" }), 100)
      } else {
        const err = await res.json()
        setPreviewError(err.detail || err.error || "Помилка")
      }
    } catch (e) {
      setPreviewError(String(e))
    }
    setPreviewLoading(false)
  }

  function handleSort(col: string) {
    const newOrder = sortBy === col && order === "desc" ? "asc" : "desc"
    setSortBy(col)
    setOrder(newOrder)
    setOffset(0)
    fetchFiles(0, search, filterSource, col, newOrder)
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return <span className="text-gray-600 ml-1">↕</span>
    return <span className="text-[#C9A84C] ml-1">{order === "desc" ? "↓" : "↑"}</span>
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Диск</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Файли на диску /root/laws_raw/ — перегляд і пошук</p>
        </div>

        {/* Disk summary */}
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
              /root/laws_raw/
              {disk && <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">{disk.total_mb} MB</span>}
            </h3>
            <button onClick={() => { fetchDisk(); fetchFiles(0) }} disabled={diskLoading}
              className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] text-sm hover:bg-[#1e293b] disabled:opacity-50 transition-colors">
              {diskLoading ? "..." : "Оновити"}
            </button>
          </div>
          {disk && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {SOURCES.map(src => {
                const s = disk.sources[src]
                return (
                  <button
                    key={src}
                    onClick={() => { setFilterSource(src === filterSource ? "" : src); setOffset(0); fetchFiles(0, search, src === filterSource ? "" : src, sortBy, order) }}
                    className={`text-center rounded-xl border px-2 py-3 transition-colors hover:border-[#C9A84C]/40 cursor-pointer ${filterSource === src ? "border-[#C9A84C]/40 bg-[#C9A84C]/5 ring-1 ring-[#C9A84C]/30" : "border-[#C9A84C]/10 bg-[#0A0E1A]"}`}
                  >
                    <div className="text-base sm:text-lg font-black text-emerald-400">{s?.files?.toLocaleString() ?? 0}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">{src}</div>
                    <div className="text-[10px] text-gray-600">{s?.size_mb ?? 0} MB</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* File browser */}
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-4 sm:p-5 space-y-4">
          <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">
            Файли
            <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
              {total > 0 ? `${total.toLocaleString()} знайдено` : ""}
            </span>
          </h3>

          <div className="flex flex-wrap gap-2 items-end">
            <input
              type="text"
              placeholder="Пошук за ID або назвою..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="flex-1 min-w-[220px] bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED] placeholder:text-gray-600"
            />
            <select
              value={filterSource}
              onChange={e => { setFilterSource(e.target.value); setOffset(0); fetchFiles(0, search, e.target.value, sortBy, order) }}
              className="bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-lg px-3 py-2 text-sm text-[#E0E6ED]"
            >
              <option value="">Всі джерела</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={handleSearch}
              disabled={filesLoading}
              className="px-4 py-2 rounded-lg bg-[#C9A84C] text-[#0A0E1A] font-bold text-sm hover:bg-[#d4b460] disabled:opacity-50 transition-colors"
            >
              {filesLoading ? "..." : "Знайти"}
            </button>
            {(search || filterSource) && (
              <button
                onClick={() => { setSearch(""); setFilterSource(""); setOffset(0); fetchFiles(0, "", "", sortBy, order) }}
                className="px-3 py-2 rounded-lg bg-[#1a2235] border border-[#C9A84C]/20 text-gray-400 text-sm hover:text-[#E0E6ED] transition-colors"
              >
                ✕ Скинути
              </button>
            )}
          </div>

          {files.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-gray-500 uppercase tracking-wider border-b border-[#C9A84C]/10">
                      <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none" onClick={() => handleSort("law_id")}>
                        ID <SortIcon col="law_id" />
                      </th>
                      <th className="pb-2 pr-3 hidden sm:table-cell">Дж.</th>
                      <th className="pb-2 pr-3">Назва</th>
                      <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none text-right hidden sm:table-cell" onClick={() => handleSort("size")}>
                        KB <SortIcon col="size" />
                      </th>
                      <th className="pb-2 pr-3 cursor-pointer hover:text-gray-300 select-none hidden sm:table-cell" onClick={() => handleSort("mtime")}>
                        Час <SortIcon col="mtime" />
                      </th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#C9A84C]/5">
                    {files.map(f => (
                      <tr key={`${f.source}-${f.law_id}`} className="text-[#E0E6ED] hover:bg-[#C9A84C]/5 transition-colors">
                        <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-400 max-w-[90px] truncate">{f.law_id}</td>
                        <td className="py-1.5 pr-3 text-gray-500 hidden sm:table-cell">{f.source}</td>
                        <td className="py-1.5 pr-3 max-w-[140px] sm:max-w-[280px] truncate text-gray-300">{f.title || "—"}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-500 hidden sm:table-cell">{f.size_kb}</td>
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap hidden sm:table-cell">
                          {new Date(f.mtime).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-1.5">
                          <button
                            onClick={() => handlePreview(f.source, f.law_id)}
                            disabled={previewLoading}
                            className="px-2 py-0.5 rounded bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/20 hover:bg-[#C9A84C]/20 transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            Читати
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
                <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} з {total.toLocaleString()}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { const o = Math.max(0, offset - PAGE_SIZE); setOffset(o); fetchFiles(o) }}
                    disabled={offset === 0 || filesLoading}
                    className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                  >← Назад</button>
                  <span className="px-2 py-1 text-gray-600">стор. {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                  <button
                    onClick={() => { const o = offset + PAGE_SIZE; setOffset(o); fetchFiles(o) }}
                    disabled={offset + PAGE_SIZE >= total || filesLoading}
                    className="px-3 py-1 rounded bg-[#1a2235] border border-[#C9A84C]/20 text-[#E0E6ED] disabled:opacity-40 hover:bg-[#1e293b] transition-colors"
                  >Вперед →</button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-600 py-6 text-center">
              {filesLoading ? "Завантаження..." : total === 0 && search ? "Нічого не знайдено" : "Натисніть «Знайти» для пошуку"}
            </div>
          )}
        </div>

        {/* Law preview */}
        {(preview || previewError) && (
          <div id="law-preview" className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#C9A84C] uppercase tracking-wider">Перегляд тексту</h3>
              <button onClick={() => { setPreview(null); setPreviewError("") }} className="text-gray-500 hover:text-gray-300 text-sm">✕ Закрити</button>
            </div>

            {previewError && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{previewError}</div>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className="font-mono font-bold text-[#C9A84C]">{preview.law_id}</span>
                    <span>·</span><span>{preview.source}</span>
                    <span>·</span><span>{preview.size_kb} KB</span>
                    <span>·</span><span>{preview.chars.toLocaleString()} символів</span>
                    {!!preview.meta.law_url && (
                      <><span>·</span>
                      <a href={String(preview.meta.law_url)} target="_blank" rel="noopener noreferrer" className="text-[#C9A84C] hover:underline">
                        Відкрити на сайті →
                      </a></>
                    )}
                  </div>
                  {!!preview.meta.title && (
                    <div className="text-sm font-semibold text-[#E0E6ED]">{String(preview.meta.title)}</div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                    {(([
                      ["Статус",        preview.meta.status],
                      ["Тип документа", preview.meta.doc_type],
                      ["Номер",         preview.meta.doc_number],
                      ["Автор",         preview.meta.author],
                      ["Дата прийняття",preview.meta.date_adopted],
                      ["Набр. чинності",preview.meta.effective_date],
                      ["Категорія",     preview.meta.category],
                      ["Scraped at",    preview.meta.scraped_at],
                    ] as [string, unknown][]).map(([label, val]) => !!val ? (
                      <div key={label} className="flex gap-1">
                        <span className="text-gray-600 shrink-0">{label}:</span>
                        <span className={`truncate ${label === "Статус" && String(val).includes("Чинний") ? "text-emerald-400" : label === "Статус" ? "text-amber-400" : "text-gray-300"}`}>
                          {String(val)}
                        </span>
                      </div>
                    ) : null))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {!!preview.meta.is_retroactive && <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30">Зворотна дія</span>}
                    {!!preview.meta.wartime_only && <span className="px-2 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-300 border border-orange-500/30">Воєнний стан</span>}
                    {!!preview.meta.is_suspended && <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-300 border border-red-500/30">Зупинено</span>}
                    {!!preview.meta.has_transitional && <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30">Перехідні положення</span>}
                  </div>
                </div>
                <pre className="font-mono text-[11px] text-gray-300 whitespace-pre-wrap break-words max-h-[600px] overflow-y-auto leading-relaxed bg-[#0A0E1A] rounded-xl border border-[#C9A84C]/10 p-4">
                  {preview.text}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
