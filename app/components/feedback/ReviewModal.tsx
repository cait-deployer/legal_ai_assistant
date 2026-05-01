"use client"

import { useState } from "react"
import { CheckCircle2, Gift, Send, Star, X } from "lucide-react"
import { AudioRecorderButton } from "./AudioRecorderButton"

const TAGS: Record<"positive" | "negative", string[]> = {
  positive: ["Зрозумілі відповіді", "Корисні посилання", "Швидка робота", "Точна інформація", "Зручний інтерфейс"],
  negative: ["Відповіді неточні", "Не зрозуміло", "Немає потрібної теми", "Повільно працює", "Складний інтерфейс"],
}

interface Props {
  rewardEligible: boolean
  rewardAmount?: number
  onClose: () => void
  onLater?: () => void
  onSubmitted?: (rewarded: boolean, bonusAdded: number) => void
}

export function ReviewModal({ rewardEligible, rewardAmount = 5, onClose, onLater, onSubmitted }: Props) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [selectedTags, setTags] = useState<string[]>([])
  const [text, setText] = useState("")
  const [submitting, setSubmit] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [bonus, setBonus] = useState(0)

  const sentiment: "positive" | "negative" | null =
    rating >= 4 ? "positive" : rating > 0 ? "negative" : null

  const tags = sentiment ? TAGS[sentiment] : []

  const toggleTag = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])

  const handleSubmit = async () => {
    if (!rating || submitting) return
    setError("")
    setSubmit(true)
    try {
      const review_text = [
        selectedTags.join(", "),
        text.trim(),
      ].filter(Boolean).join(". ") || "Без додаткового коментаря"

      const res = await fetch("/api/feedback/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, review_text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Помилка збереження")
        return
      }
      setBonus(data.bonus_added ?? 0)
      setDone(true)
      onSubmitted?.(data.rewarded, data.bonus_added ?? 0)
    } finally {
      setSubmit(false)
    }
  }

  const textPrompt = rating > 0 && rating <= 3
    ? "Що можемо покращити? Можна написати або надиктувати..."
    : rating > 3
      ? "Що найбільше сподобалось? Можна написати або надиктувати..."
      : "Поділіться враженням про URAI..."
  const closeWithoutSubmit = done ? onClose : (onLater ?? onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) closeWithoutSubmit() }}
    >
      <div className="relative w-full max-w-lg bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-5 border-b border-[#C9A84C]/10 bg-[#0d1120]/80">
          <button
            onClick={closeWithoutSubmit}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-[#E0E6ED]/40 hover:text-[#E0E6ED] hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-11 h-11 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center mb-4">
            <Star className="w-5 h-5 text-[#C9A84C]" />
          </div>
          <h3 className="font-serif text-2xl font-bold text-[#E0E6ED] mb-1">Як вам URAI?</h3>
          {rewardEligible ? (
            <div className="flex items-center gap-1.5">
              <Gift className="w-3.5 h-3.5 text-[#C9A84C]" />
              <p className="text-xs text-[#C9A84C] font-medium">
                Залиште відгук і отримайте +{rewardAmount} запитів безкоштовно
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#E0E6ED]/50">Ваш відгук допомагає нам ставати кращими</p>
          )}
        </div>

        <div className="p-6 space-y-4">
          {done ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-[#C9A84C]" />
              </div>
              <h3 className="text-lg font-semibold text-[#E0E6ED]">Дякуємо за відгук!</h3>
              {bonus > 0 && (
                <div className="flex items-center justify-center gap-2 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl px-4 py-3">
                  <Gift className="w-4 h-4 text-[#C9A84C]" />
                  <span className="text-sm font-medium text-[#C9A84C]">+{bonus} запитів додано до вашого рахунку</span>
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2 rounded-lg bg-white/5 text-[#E0E6ED]/60 hover:bg-white/10 transition-colors text-sm"
              >
                Закрити
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2 justify-center py-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => { setRating(s); setTags([]) }}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className="w-9 h-9"
                      fill={(hovered || rating) >= s ? "#C9A84C" : "transparent"}
                      stroke={(hovered || rating) >= s ? "#C9A84C" : "#E0E6ED40"}
                    />
                  </button>
                ))}
              </div>

              {sentiment && (
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
              )}

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={textPrompt}
                rows={3}
                className="w-full resize-none bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#E0E6ED] placeholder-[#E0E6ED]/30 focus:outline-none focus:border-[#C9A84C]/40 transition-colors"
              />

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <AudioRecorderButton onTranscription={t => setText(prev => prev ? `${prev} ${t}` : t)} />
                <div className="flex items-center gap-2 sm:ml-auto">
                  <button
                    type="button"
                    onClick={onLater ?? onClose}
                    className="px-4 py-2.5 rounded-xl border border-[#C9A84C]/15 text-[#E0E6ED]/55 text-sm font-semibold hover:text-[#E0E6ED] hover:bg-white/5 transition-colors"
                  >
                    Залишити пізніше
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!rating || submitting}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C9A84C] text-[#0A0E1A] font-semibold text-sm hover:bg-[#E2C47A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submitting
                      ? "Надсилається..."
                      : rewardEligible
                        ? `Надіслати +${rewardAmount}`
                        : "Надіслати"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
