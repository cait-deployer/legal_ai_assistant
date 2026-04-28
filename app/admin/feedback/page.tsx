"use client"

import { useState, useEffect, useCallback } from "react"
import { ThumbsUp, ThumbsDown, Star, RefreshCw, ChevronLeft, ChevronRight, X, User, Bot, Loader2 } from "lucide-react"

type MessageFeedbackRow = {
  id: string
  user_id: string
  chat_id: string
  message_id: string
  is_positive: boolean
  tags: string[]
  feedback_text: string | null
  audio_transcription: string | null
  created_at: string
  updated_at: string
  profiles: { email: string; full_name: string | null } | null
}

type ReviewRow = {
  id: string
  user_id: string
  rating: number
  review_text: string
  created_at: string
  profiles: { email: string; full_name: string | null } | null
}

type MessageDetail = {
  ai_message:   { id: string; role: string; content: string; created_at: string } | null
  user_message: { id: string; role: string; content: string; created_at: string } | null
}

const PAGE_SIZE = 50

function DetailModal({ row, onClose }: { row: MessageFeedbackRow; onClose: () => void }) {
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/feedback/detail?message_id=${row.message_id}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [row.message_id])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-[#0d1120] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between border-b ${row.is_positive ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20"}`}>
          <div className="flex items-center gap-3">
            {row.is_positive
              ? <ThumbsUp className="w-5 h-5 text-emerald-400" />
              : <ThumbsDown className="w-5 h-5 text-red-400" />}
            <div>
              <p className="text-sm font-semibold text-[#E0E6ED]">
                {row.profiles?.email ?? row.user_id.slice(0, 8)}
              </p>
              <p className="text-xs text-[#E0E6ED]/40">
                {new Date(row.created_at).toLocaleString("uk")}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#E0E6ED]/40 hover:text-[#E0E6ED] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          {/* Feedback details */}
          <div className="space-y-3">
            {row.tags?.length > 0 && (
              <div>
                <p className="text-[10px] text-[#E0E6ED]/40 uppercase tracking-wider mb-1.5">Теги</p>
                <div className="flex flex-wrap gap-1.5">
                  {row.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 rounded-full bg-[#C9A84C]/15 border border-[#C9A84C]/30 text-[#C9A84C] text-xs">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            {(row.feedback_text || row.audio_transcription) && (
              <div>
                <p className="text-[10px] text-[#E0E6ED]/40 uppercase tracking-wider mb-1.5">Коментар</p>
                <p className="text-sm text-[#E0E6ED]/80 bg-white/5 rounded-xl px-4 py-3">
                  {row.feedback_text ?? row.audio_transcription}
                </p>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-white/8" />

          {/* Message context */}
          <div>
            <p className="text-[10px] text-[#E0E6ED]/40 uppercase tracking-wider mb-3">Контекст повідомлення</p>

            {loading ? (
              <div className="flex items-center gap-2 text-[#E0E6ED]/40 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Завантаження…
              </div>
            ) : !detail || !detail.ai_message ? (
              <p className="text-sm text-[#E0E6ED]/30 italic">Повідомлення не знайдено</p>
            ) : (
              <div className="space-y-3">
                {detail.user_message && (
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-[#E0E6ED]/60" />
                    </div>
                    <div className="flex-1 bg-white/5 rounded-xl px-4 py-3">
                      <p className="text-[10px] text-[#E0E6ED]/40 mb-1">Питання користувача</p>
                      <p className="text-sm text-[#E0E6ED]/90 whitespace-pre-wrap">{detail.user_message.content}</p>
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#C9A84C]/20 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-[#C9A84C]" />
                  </div>
                  <div className="flex-1 bg-white/5 rounded-xl px-4 py-3">
                    <p className="text-[10px] text-[#E0E6ED]/40 mb-1">Відповідь URAI</p>
                    <p className="text-sm text-[#E0E6ED]/90 whitespace-pre-wrap line-clamp-[12]">
                      {detail.ai_message.content}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* IDs for debugging */}
          <div className="pt-2 border-t border-white/5">
            <p className="text-[10px] text-[#E0E6ED]/20 font-mono">
              message_id: {row.message_id} · chat_id: {row.chat_id}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FeedbackAdminPage() {
  const [tab, setTab]       = useState<"message" | "review">("message")
  const [rows, setRows]     = useState<(MessageFeedbackRow | ReviewRow)[]>([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<MessageFeedbackRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/feedback?type=${tab}&page=${page}&limit=${PAGE_SIZE}`)
      const data = await res.json()
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [tab, page])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const msgRows = rows as MessageFeedbackRow[]
  const positiveCount = msgRows.filter(r => r.is_positive).length
  const negativeCount = msgRows.filter(r => !r.is_positive).length

  const revRows = rows as ReviewRow[]
  const avgRating = revRows.length
    ? (revRows.reduce((s, r) => s + r.rating, 0) / revRows.length).toFixed(1)
    : "—"

  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#C9A84C]">Відгуки користувачів</h1>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Оновити
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(["message", "review"] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(0) }}
              className={[
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                tab === t
                  ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/30"
                  : "bg-white/5 text-[#E0E6ED]/60 hover:bg-white/10",
              ].join(" ")}
            >
              {t === "message" ? "👍👎 Inline відгуки" : "⭐ Рейтинги застосунку"}
            </button>
          ))}
        </div>

        {/* Stats */}
        {tab === "message" && rows.length > 0 && (
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-400">👍 {positiveCount}</span>
            <span className="text-red-400">👎 {negativeCount}</span>
            <span className="text-[#E0E6ED]/40">Всього: {rows.length} / {total}</span>
            <span className="text-[#E0E6ED]/30 text-xs mt-0.5">← натисни на рядок для деталей</span>
          </div>
        )}
        {tab === "review" && rows.length > 0 && (
          <div className="flex gap-4 text-sm">
            <span className="text-[#C9A84C]">⭐ Середній рейтинг: {avgRating}</span>
            <span className="text-[#E0E6ED]/40">Всього: {total}</span>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[#E0E6ED]/40">Завантаження…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-[#E0E6ED]/40">Відгуків ще немає</div>
          ) : tab === "message" ? (
            <table className="w-full text-xs">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Оцінка</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Юзер</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Теги</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Коментар</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(rows as MessageFeedbackRow[]).map(row => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      {row.is_positive
                        ? <ThumbsUp className="w-4 h-4 text-emerald-400" />
                        : <ThumbsDown className="w-4 h-4 text-red-400" />}
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/70">
                      {row.profiles?.email ?? row.user_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.tags?.map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 rounded bg-white/10 text-[#E0E6ED]/60">{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/80 max-w-xs">
                      <p className="truncate">{row.feedback_text ?? row.audio_transcription ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/40 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString("uk")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Рейтинг</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Юзер</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Відгук</th>
                  <th className="text-left px-4 py-3 text-[#E0E6ED]/50 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(rows as ReviewRow[]).map(row => (
                  <tr key={row.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className="w-3.5 h-3.5"
                            fill={i < row.rating ? "#C9A84C" : "transparent"}
                            stroke={i < row.rating ? "#C9A84C" : "#E0E6ED40"}
                          />
                        ))}
                        <span className="ml-1 text-[#E0E6ED]/50">{row.rating}/5</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/70">
                      {row.profiles?.email ?? row.user_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/80 max-w-sm">
                      <p className="line-clamp-2">{row.review_text}</p>
                    </td>
                    <td className="px-4 py-3 text-[#E0E6ED]/40 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString("uk")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-3 justify-center text-sm">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[#E0E6ED]/50">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <DetailModal row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
