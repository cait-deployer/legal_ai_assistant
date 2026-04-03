"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import { ExternalLink, Scale, FileText, Hash } from "lucide-react"
import type { Law } from "./laws-list"

export const CATEGORY_LABELS: Record<string, string> = {
  h14: "Збройні сили",
  h25: "Кримінальне право",
  h19: "Трудові відносини",
  h20: "Соціальний захист",
}

const CATEGORY_STYLES: Record<string, string> = {
  h14: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  h25: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
  h19: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
  h20: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
}

const STATUS_STYLES: Record<string, string> = {
  "Чинний": "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  "Невідомо": "bg-muted text-muted-foreground border-border",
}

export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? "bg-muted text-muted-foreground border-border"
}

export function getCategoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat
}

export function getCategoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? "bg-muted text-muted-foreground border-border"
}

type Props = {
  law: Law
  isActive?: boolean
  onOpen: () => void
}

export function LawCard({ law, isActive, onOpen }: Props) {
  const meta = law.metadata
  const preview = law.content.slice(0, 260).trim()
  const hasMore = law.content.length > 260

  return (
    <TooltipProvider>
      <Card
        onClick={onOpen}
        className={`
          group !p-0 gap-0 flex flex-col transition-all duration-200 overflow-hidden cursor-pointer
          ${isActive
            ? "border-primary shadow-md ring-2 ring-primary/30"
            : "hover:border-primary/40 hover:shadow-md"
          }
        `}
      >
        {/* top accent bar */}
        <div className={`h-1 w-full shrink-0 transition-all duration-200 ${isActive ? "bg-primary" : "bg-gradient-to-r from-primary/60 via-primary/30 to-transparent"}`} />

        <CardContent className="flex-1 pt-3 pb-3 px-4 space-y-3">
          {/* icon + title */}
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Scale className="w-4 h-4 text-primary" />
            </div>
            <p className="font-semibold text-sm leading-snug line-clamp-2 min-w-0">
              {meta.source || `Закон ${meta.law_id}`}
            </p>
          </div>

          {/* status + category badges */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${getStatusStyle(meta.status)}`}>
              {meta.status || "Невідомо"}
            </span>
            {meta.category && (
              <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${getCategoryStyle(meta.category)}`}>
                {getCategoryLabel(meta.category)}
              </span>
            )}
          </div>

          {/* law id */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hash className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono truncate">{meta.law_id}</span>
          </div>

          {/* content preview */}
          {preview && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {preview}{hasMore ? "…" : ""}
            </p>
          )}
        </CardContent>

        <CardFooter
          className="pt-0 pb-3 px-4 flex gap-2 border-t border-border/50 bg-muted/20"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost" size="sm"
            className="flex-1 gap-1.5 h-8 hover:text-primary hover:bg-primary/10 transition-colors"
            onClick={onOpen}
          >
            <FileText className="w-3.5 h-3.5" /> Читати
          </Button>
          {meta.law_url && (
            <>
              <div className="w-px h-5 bg-border/60 self-center" />
              <Tooltip>
                <TooltipTrigger>
                  <a
                    href={meta.law_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 gap-1.5 h-8 inline-flex items-center justify-center rounded-md text-xs font-medium hover:text-primary hover:bg-primary/10 transition-colors text-muted-foreground"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> РАДА
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top"><p>Відкрити на zakon.rada.gov.ua</p></TooltipContent>
              </Tooltip>
            </>
          )}
        </CardFooter>
      </Card>
    </TooltipProvider>
  )
}