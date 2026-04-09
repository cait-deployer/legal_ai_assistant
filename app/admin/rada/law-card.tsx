"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ExternalLink, Scale, FileText, Hash } from "lucide-react"
import type { Law } from "./laws-list"

export const CATEGORY_LABELS: Record<string, string> = {
  h1: "Господарсько-процесуальне",
  h2: "Банки, фінанси, бюджет",
  h3: "Бухоблік, оподаткування",
  h4: "Держ. та суспільний устрій",
  h5: "Цивільне законодавство",
  h6: "Житлове законодавство",
  h7: "Транспорт, зв'язок",
  h8: "Адмін. відповідальність",
  h9: "Природні ресурси, довкілля",
  h10: "Ліцензування, сертифікація",
  h11: "Міжнародні відносини",
  h12: "Наука, освіта, культура",
  h13: "Нотаріат, адвокатура",
  h14: "Охорона, безпека, правопорядок",
  h15: "Підприємства, інвестиції",
  h16: "Охорона здоров'я, сім'я",
  h17: "Промисловість, енергетика",
  h18: "Сільське господарство",
  h19: "Трудові відносини",
  h20: "Соціальне забезпечення",
  h21: "Будівництво, архітектура",
  h22: "Суд, прокуратура, юстиція",
  h23: "Митна діяльність, ЗЕД",
  h24: "Торгівля, побутові послуги",
  h25: "Кримінальне законодавство",
  h26: "Цінні папери, фондовий ринок",
  h27: "Кадрові питання",
  h28: "Регіональне законодавство",
  h29: "Проекти. Внесення змін",
  h30: "Судова практика (РАДА)",
  h31: "Правове регулювання економіки",
  h32: "Ядерне законодавство",
}

const CATEGORY_STYLES: Record<string, string> = {
  h1: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  h2: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  h3: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  h4: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  h5: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  h6: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  h7: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  h8: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  h9: "bg-green-500/10 text-green-400 border-green-500/20",
  h10: "bg-lime-500/10 text-lime-400 border-lime-500/20",
  h11: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  h12: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  h13: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
  h14: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  h15: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  h16: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  h17: "bg-amber-600/10 text-amber-500 border-amber-600/20",
  h18: "bg-green-600/10 text-green-500 border-green-600/20",
  h19: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  h20: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  h21: "bg-stone-500/10 text-stone-400 border-stone-500/20",
  h22: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  h23: "bg-cyan-600/10 text-cyan-500 border-cyan-600/20",
  h24: "bg-orange-600/10 text-orange-500 border-orange-600/20",
  h25: "bg-red-500/10 text-red-400 border-red-500/20",
  h26: "bg-violet-600/10 text-violet-500 border-violet-600/20",
  h27: "bg-sky-600/10 text-sky-500 border-sky-600/20",
  h28: "bg-indigo-600/10 text-indigo-500 border-indigo-600/20",
  h29: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  h30: "bg-purple-600/10 text-purple-500 border-purple-600/20",
  h31: "bg-teal-600/10 text-teal-500 border-teal-600/20",
  h32: "bg-red-700/10 text-red-500 border-red-700/20",
}

const STATUS_STYLES: Record<string, string> = {
  "Чинний": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Невідомо": "bg-[#C9A84C]/5 text-[#C9A84C]/70 border-[#C9A84C]/10",
}

export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? "bg-[#C9A84C]/5 text-[#C9A84C]/70 border-[#C9A84C]/10"
}

export function getCategoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat
}

export function getCategoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? "bg-[#C9A84C]/5 text-[#C9A84C]/70 border-[#C9A84C]/10"
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
            ? "border-[#C9A84C] shadow-lg shadow-[#C9A84C]/10 ring-1 ring-[#C9A84C]/20"
            : "border-[#C9A84C]/10 hover:border-[#C9A84C]/30 hover:shadow-md hover:shadow-black/20"
          }
        `}
      >
        {/* top accent bar */}
        <div className={`h-0.5 w-full shrink-0 transition-all duration-200 ${isActive ? "bg-[#C9A84C]" : "bg-gradient-to-r from-[#C9A84C]/40 via-[#C9A84C]/20 to-transparent"}`} />

        <div className="flex-1 pt-4 pb-3 px-4 space-y-3">
          {/* icon + title */}
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center shrink-0 mt-0.5">
              <Scale className="w-4 h-4 text-[#C9A84C]" />
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
          <div className="flex items-center gap-1.5 text-xs text-[#C9A84C]/70">
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
          className="pt-2 pb-3 px-4 flex gap-2 border-t border-[#C9A84C]/10 bg-[#0A0E1A]/30"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost" size="sm"
            className="flex-1 gap-1.5 h-8 text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors rounded-xl text-xs"
            onClick={onOpen}
          >
            <FileText className="w-3.5 h-3.5" /> Читати
          </Button>
          {meta.law_url && (
            <>
              <div className="w-px h-5 bg-[#C9A84C]/10 self-center" />
              <Tooltip>
                <TooltipTrigger>
                  <a
                    href={meta.law_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 gap-1.5 h-8 inline-flex items-center justify-center rounded-xl text-xs font-medium hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors text-[#C9A84C]/70"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> РАДА
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-[#0d1120] border-[#C9A84C]/20 text-[#E0E6ED]"><p>Відкрити на zakon.rada.gov.ua</p></TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
