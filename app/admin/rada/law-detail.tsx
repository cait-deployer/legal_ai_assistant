"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  X, Scale, Hash, ExternalLink, Calendar, Layers,
  AlertCircle, BookOpen,
} from "lucide-react"
import {
  getCategoryLabel, getCategoryStyle, getStatusStyle, CATEGORY_LABELS,
} from "./law-card"
import type { Law } from "./laws-list"

type LawFull = {
  law_id: string
  source: string
  status: string
  law_url: string
  category: string
  chunk_count: number
  full_text: string
  scraped_at: string
}

type Props = {
  law: Law
  onClose: () => void
  textApiPath?: string
}

export function LawDetail({ law, onClose, textApiPath = "/api/admin/rada/laws/text" }: Props) {
  const [full, setFull] = useState<LawFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const meta = law.metadata

  useEffect(() => {
    setLoading(true)
    setError(null)
    setFull(null)

    fetch(`${textApiPath}?law_id=${encodeURIComponent(meta.law_id)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Помилка ${r.status}`)
        return r.json()
      })
      .then((d) => setFull(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [meta.law_id])

  const scrapedAt = full?.scraped_at
    ? new Date(full.scraped_at).toLocaleDateString("uk-UA", { day: "2-digit", month: "long", year: "numeric" })
    : null

  return (
    <div className="flex flex-col h-full bg-card">
      {/* header */}
      <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-primary/5 to-transparent shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Scale className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-snug line-clamp-2">
                {meta.source || `Закон ${meta.law_id}`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* badges */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${getStatusStyle(meta.status)}`}>
            {meta.status || "Невідомо"}
          </span>
          {meta.category && (
            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${getCategoryStyle(meta.category)}`}>
              {getCategoryLabel(meta.category)}
            </span>
          )}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">

        {/* metadata */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">ID Закону</p>
              <p className="text-sm mt-0.5 font-mono break-all">{meta.law_id}</p>
            </div>
          </div>

          {scrapedAt && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Завантажено</p>
                <p className="text-sm mt-0.5">{scrapedAt}</p>
              </div>
            </div>
          )}

          {full?.chunk_count != null && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Частин тексту</p>
                <p className="text-sm mt-0.5">{full.chunk_count}</p>
              </div>
            </div>
          )}

          {meta.law_url && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Джерело</p>
                <a
                  href={meta.law_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm mt-0.5 text-primary hover:underline underline-offset-2 flex items-center gap-1 break-all"
                >
                  {(() => { try { return new URL(meta.law_url).hostname } catch { return meta.law_url } })()}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* full text */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Повний текст
          </p>

          {loading && (
            <div className="space-y-2 pt-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full rounded" style={{ width: `${85 + (i % 3) * 5}%` }} />
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && full?.full_text && (
            <div className="bg-muted/30 rounded-xl border border-border p-4 text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono max-h-[50vh] overflow-y-auto">
              {full.full_text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}