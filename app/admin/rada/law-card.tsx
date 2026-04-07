"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ExternalLink, Scale, FileText, Hash } from "lucide-react"
import type { Law } from "./laws-list"

export const CATEGORY_LABELS: Record<string, string> = {
  h14: "Збройні сили",
  h25: "Кримінальне право",
  h19: "Трудові відносини",
  h20: "Соціальний захист",
}

const CATEGORY_STYLES: Record<string, string> = {
  h14: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  h25: "bg-red-500/10 text-red-400 border-red-500/20",
  h19: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  h20: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
}

const STATUS_STYLES: Record<string, string> = {
  "Чинний": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Невідомо": "bg-[#BFA071]/5 text-[#BFA071]/70 border-[#BFA071]/10",
}

export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? "bg-[#BFA071]/5 text-[#BFA071]/70 border-[#BFA071]/10"
}

export function getCategoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat
}

export function getCategoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? "bg-[#BFA071]/5 text-[#BFA071]/70 border-[#BFA071]/10"
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
      <div
        onClick={onOpen}
        className={`
          group flex flex-col transition-all duration-200 overflow-hidden cursor-pointer rounded-2xl border
          bg-[#0d1120]/60
          ${isActive
            ? "border-[#BFA071] shadow-lg shadow-[#BFA071]/10 ring-1 ring-[#BFA071]/20"
            : "border-[#BFA071]/10 hover:border-[#BFA071]/30 hover:shadow-md hover:shadow-black/20"
          }
        `}
      >
        {/* top accent bar */}
        <div className={`h-0.5 w-full shrink-0 transition-all duration-200 ${isActive ? "bg-[#BFA071]" : "bg-gradient-to-r from-[#BFA071]/40 via-[#BFA071]/20 to-transparent"}`} />

        <div className="flex-1 pt-4 pb-3 px-4 space-y-3">
          {/* icon + title */}
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#BFA071]/10 flex items-center justify-center shrink-0 mt-0.5">
              <Scale className="w-4 h-4 text-[#BFA071]" />
            </div>
            <p className="font-semibold text-sm leading-snug line-clamp-2 min-w-0 text-[#E0E6ED]">
              {meta.source || `Закон ${meta.law_id}`}
            </p>
          </div>

          {/* status + category badges */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border ${getStatusStyle(meta.status)}`}>
              {meta.status || "Невідомо"}
            </span>
            {meta.category && (
              <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border ${getCategoryStyle(meta.category)}`}>
                {getCategoryLabel(meta.category)}
              </span>
            )}
          </div>

          {/* law id */}
          <div className="flex items-center gap-1.5 text-xs text-[#BFA071]/70">
            <Hash className="w-3.5 h-3.5 shrink-0" />
            <span className="font-mono truncate">{meta.law_id}</span>
          </div>

          {/* content preview */}
          {preview && (
            <p className="text-xs text-[#E0E6ED]/70 leading-relaxed line-clamp-3">
              {preview}{hasMore ? "…" : ""}
            </p>
          )}
        </div>

        <div
          className="pt-2 pb-3 px-4 flex gap-2 border-t border-[#BFA071]/10 bg-[#0A0E1A]/30"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost" size="sm"
            className="flex-1 gap-1.5 h-8 text-[#BFA071]/70 hover:text-[#BFA071] hover:bg-[#BFA071]/10 transition-colors rounded-xl text-xs"
            onClick={onOpen}
          >
            <FileText className="w-3.5 h-3.5" /> Читати
          </Button>
          {meta.law_url && (
            <>
              <div className="w-px h-5 bg-[#BFA071]/10 self-center" />
              <Tooltip>
                <TooltipTrigger>
                  <a
                    href={meta.law_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 gap-1.5 h-8 inline-flex items-center justify-center rounded-xl text-xs font-medium hover:text-[#BFA071] hover:bg-[#BFA071]/10 transition-colors text-[#BFA071]/70"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> РАДА
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-[#0d1120] border-[#BFA071]/20 text-[#E0E6ED]"><p>Відкрити на zakon.rada.gov.ua</p></TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
