"use client"

import { FileText, ExternalLink, ChevronRight, Hash } from "lucide-react"
import { getCategoryLabel, getCategoryStyle, getStatusStyle } from "./law-card"
import type { Law } from "./laws-list"

type Props = {
  laws: Law[]
  activeId?: number | null
  onOpen: (law: Law) => void
}

export function LawTable({ laws, activeId, onOpen }: Props) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground w-[40%]">Назва</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground w-28">Статус</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Категорія</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden md:table-cell">ID закону</th>
              <th className="px-4 py-3 w-[90px]" />
            </tr>
          </thead>
          <tbody>
            {laws.map((law) => {
              const meta = law.metadata
              const isActive = activeId === law.id
              return (
                <tr
                  key={law.id}
                  onClick={() => onOpen(law)}
                  className={`border-b last:border-0 transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary/5 border-l-2 border-primary"
                      : "hover:bg-muted/30"
                  }`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm leading-snug line-clamp-2">
                      {meta.source || `Закон ${meta.law_id}`}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${getStatusStyle(meta.status)}`}>
                      {meta.status || "Невідомо"}
                    </span>
                  </td>

                  <td className="px-4 py-3 hidden sm:table-cell">
                    {meta.category ? (
                      <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${getCategoryStyle(meta.category)}`}>
                        {getCategoryLabel(meta.category)}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>

                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Hash className="w-3 h-3 shrink-0" />
                      <span className="font-mono truncate max-w-[120px]">{meta.law_id}</span>
                    </div>
                  </td>

                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-0.5 justify-end">
                      <button
                        title="Читати текст"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => onOpen(law)}
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      {meta.law_url && (
                        <a
                          href={meta.law_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="zakon.rada.gov.ua"
                          onClick={(e) => e.stopPropagation()}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        title="Деталі"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => onOpen(law)}
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
  )
}