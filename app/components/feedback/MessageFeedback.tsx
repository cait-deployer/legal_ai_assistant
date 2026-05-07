"use client"

import { useEffect, useRef, useState } from "react"
import { ThumbsUp, ThumbsDown, X, Send, Star } from "lucide-react"
import { AudioRecorderButton } from "./AudioRecorderButton"

const TAGS: Record<"positive" | "negative", string[]> = {
  positive: ["Точна відповідь", "Корисні посилання", "Зрозуміло", "Повна відповідь"],
  negative: ["Відповідь неточна", "Немає посилань", "Не стосується питання", "Незрозуміло"],
}

interface Props {
  messageId: string
  chatId: string
  initialIsPositive?: boolean | null
  betaMode?: boolean
  autoOpen?: boolean
  onSubmitted?: () => void
  showReviewButton?: boolean
  onReviewOpen?: () => void
}

type Vote = "positive" | "negative"

export function MessageFeedback({ messageId, chatId, initialIsPositive = null, betaMode = false, autoOpen = false, onSubmitted, showReviewButton = false, onReviewOpen }: Props) {
  const initialVote = initialIsPositive === null ? null : initialIsPositive ? "positive" : "negative"
  const [vote, setVote] = useState<Vote | null>(initialVote)
  const [showModal, setShowModal] = useState(false)
  const [selectedTags, setTags] = useState<string[]>([])
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(initialIsPositive !== null)
  const autoOpenedRef = useRef(false)

  useEffect(() => {
    if (!autoOpen || submitted || autoOpenedRef.current) return
    autoOpenedRef.current = true
    const timer = setTimeout(() => {
      setVote("positive")
      setTags([])
      setText("")
      setShowModal(true)
    }, 30000)
    return () => clearTimeout(timer)
  }, [autoOpen, submitted])

  const openModal = (v: Vote) => {
    setVote(v)
    setTags([])
    setText("")
    setShowModal(true)
  }

  const closeModal = () => setShowModal(false)

  const toggleTag = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])

  const handleSubmit = async () => {
    if (submitting || !vote) return
    setSubmitting(true)
    try {
      await fetch("/api/feedback/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: messageId,
          chat_id: chatId,
          is_positive: vote === "positive",
          tags: selectedTags,
          feedback_text: text.trim() || null,
        }),
      })
      setSubmitted(true)
      onSubmitted?.()
      setTimeout(() => setShowModal(false), 1200)
    } finally {
      setSubmitting(false)
    }
  }

  const tags = vote ? TAGS[vote] : []

  return (
    <>
      {/* Inline thumb buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => submitted ? null : openModal("positive")}
          title="Корисно"
          className={[
            "p-1.5 rounded-lg transition-colors",
            vote === "positive" && submitted
              ? "text-emerald-400"
              : "text-[#E0E6ED]/30 hover:text-emerald-400 hover:bg-emerald-400/10",
          ].join(" ")}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => submitted ? null : openModal("negative")}
          title="Не корисно"
          className={[
            "p-1.5 rounded-lg transition-colors",
            vote === "negative" && submitted
              ? "text-red-400"
              : "text-[#E0E6ED]/30 hover:text-red-400 hover:bg-red-400/10",
          ].join(" ")}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        {submitted && (
          <span className="text-[12px] text-[#E0E6ED]/40 ml-1">Дякуємо!</span>
        )}
        {betaMode && !submitted && (
          <span className="text-[12px] text-[#C9A84C]/50 ml-1 font-medium">бета-відгук</span>
        )}
        {showReviewButton && onReviewOpen && (
          <button
            onClick={onReviewOpen}
            title="Оцінити URAI"
            className="flex items-center gap-1 ml-1 px-2 py-1 rounded-lg text-[12px] font-semibold text-[#C9A84C] bg-[#C9A84C]/10 border border-[#C9A84C]/25 hover:bg-[#C9A84C]/20 hover:border-[#C9A84C]/50 transition-all"
          >
            <Star className="w-3 h-3 fill-[#C9A84C]" />
            Оцінити
          </button>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="relative w-full max-w-md bg-[#0d1120] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

            {/* Header */}
            <div className={`px-6 py-4 flex items-center justify-between ${vote === "positive" ? "bg-emerald-500/10 border-b border-emerald-500/20" : "bg-red-500/10 border-b border-red-500/20"}`}>
              <div className="flex items-center gap-3">
                {vote === "positive"
                  ? <ThumbsUp className="w-5 h-5 text-emerald-400" />
                  : <ThumbsDown className="w-5 h-5 text-red-400" />}
                <div>
                  <p className="text-sm font-semibold text-[#E0E6ED]">
                    {vote === "positive" ? "Що сподобалось?" : "Що покращити?"}
                  </p>
                  <p className="text-xs text-[#E0E6ED]/40">
                    {betaMode ? "Бета-тестування URAI — ваш відгук важливий" : "Ваш відгук зробить URAI кращим"}
                  </p>
                </div>
              </div>
              <button onClick={closeModal} className="text-[#E0E6ED]/40 hover:text-[#E0E6ED] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {submitted ? (
                <div className="text-center py-4">
                  <p className="text-2xl mb-2">🙏</p>
                  <p className="text-sm text-[#E0E6ED]">Дякуємо за відгук!</p>
                </div>
              ) : (
                <>
                  {/* Tags */}
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={[
                          "px-3 py-1.5 rounded-full text-xs border transition-all",
                          selectedTags.includes(tag)
                            ? "bg-[#C9A84C]/20 border-[#C9A84C] text-[#C9A84C]"
                            : "border-white/15 text-[#E0E6ED]/50 hover:border-[#C9A84C]/40 hover:text-[#E0E6ED]",
                        ].join(" ")}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>

                  {/* Textarea */}
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Додатковий коментар (необов'язково)…"
                    rows={3}
                    className="w-full resize-none bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#E0E6ED] placeholder-[#E0E6ED]/30 focus:outline-none focus:border-[#C9A84C]/40 transition-colors"
                  />

                  {/* Audio + Submit */}
                  <div className="flex items-center justify-between">
                    <AudioRecorderButton
                      onTranscription={t => setText(prev => prev ? `${prev} ${t}` : t)}
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#C9A84C] text-[#0A0E1A] text-sm font-semibold hover:bg-[#E2C47A] disabled:opacity-50 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {submitting ? "Надсилається…" : "Надіслати"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
