"use client"

import { useState } from "react"
import { Star, X, Gift } from "lucide-react"

interface Props {
  rewardEligible: boolean
  onClose:        () => void
  onSubmitted?:   (rewarded: boolean, bonusAdded: number) => void
}

export function ReviewModal({ rewardEligible, onClose, onSubmitted }: Props) {
  const [rating, setRating]     = useState(0)
  const [hovered, setHovered]   = useState(0)
  const [text, setText]         = useState("")
  const [submitting, setSubmit] = useState(false)
  const [error, setError]       = useState("")
  const [done, setDone]         = useState(false)
  const [bonus, setBonus]       = useState(0)

  const handleSubmit = async () => {
    if (!rating || submitting) return
    setError("")
    setSubmit(true)
    try {
      const res  = await fetch("/api/feedback/review", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rating, review_text: text }),
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

  const prompt = rating > 0 && rating <= 3
    ? "Що можемо покращити?"
    : rating > 3
    ? "Що найбільше сподобалось?"
    : "Розкажіть детальніше…"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md bg-[#0A0E1A] border border-white/10 rounded-2xl p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#E0E6ED]/40 hover:text-[#E0E6ED] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {done ? (
          /* Success state */
          <div className="text-center py-4 space-y-3">
            <div className="text-4xl">🎉</div>
            <h3 className="text-lg font-semibold text-[#E0E6ED]">Дякуємо за відгук!</h3>
            {bonus > 0 && (
              <div className="flex items-center justify-center gap-2 text-[#C9A84C]">
                <Gift className="w-4 h-4" />
                <span className="text-sm font-medium">+{bonus} запитів додано до вашого рахунку</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded-lg bg-[#C9A84C]/20 text-[#C9A84C] hover:bg-[#C9A84C]/30 transition-colors text-sm"
            >
              Закрити
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h3 className="text-base font-semibold text-[#E0E6ED] mb-1">
                Як вам URAI?
              </h3>
              <p className="text-xs text-[#E0E6ED]/50">
                Ваш відгук допомагає нам ставати кращими.
                {rewardEligible && (
                  <span className="text-[#C9A84C]"> За розгорнутий відгук — бонусні запити!</span>
                )}
              </p>
            </div>

            {/* Star rating */}
            <div className="flex gap-1.5 mb-4">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setRating(s)}
                  onMouseEnter={() => setHovered(s)}
                  onMouseLeave={() => setHovered(0)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className="w-8 h-8"
                    fill={(hovered || rating) >= s ? "#C9A84C" : "transparent"}
                    stroke={(hovered || rating) >= s ? "#C9A84C" : "#E0E6ED40"}
                  />
                </button>
              ))}
            </div>

            {/* Text area — always shown, label changes by rating */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={prompt}
              rows={4}
              className="w-full resize-none bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-[#E0E6ED] placeholder-[#E0E6ED]/30 focus:outline-none focus:border-[#C9A84C]/40 mb-3"
            />

            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={!rating || submitting}
              className="w-full py-2.5 rounded-xl bg-[#C9A84C] text-[#0A0E1A] font-semibold text-sm hover:bg-[#C9A84C]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Надсилається…" : "Надіслати відгук"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
