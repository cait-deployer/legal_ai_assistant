"use client"

import { CheckCircle2, ThumbsDown, ThumbsUp, X } from "lucide-react"

interface Props {
  onClose: () => void
}

export function BetaTesterWelcomeModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-welcome-title"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[#C9A84C]/25 bg-[#0A0E1A] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#E0E6ED]/40 transition-colors hover:bg-white/5 hover:text-[#E0E6ED]"
          aria-label="Закрити"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-[#C9A84C]/10 bg-[#0d1120]/80 px-6 pb-5 pt-6">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/10">
            <CheckCircle2 className="h-5 w-5 text-[#C9A84C]" />
          </div>
          <p className="mb-1 text-[11px] font-black uppercase tracking-[0.22em] text-[#C9A84C]/70">
            Бета-тестування URAI
          </p>
          <h3 id="beta-welcome-title" className="font-serif text-2xl font-bold text-[#E0E6ED]">
            Вітаємо, ви отримали статус бета-тестера
          </h3>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-sm leading-6 text-[#E0E6ED]/72">
            У вас відкрито розширений доступ до URAI. Будь ласка, після відповідей асистента залишайте короткий відгук через кнопки лайк або дизлайк.
          </p>

          <div className="rounded-2xl border border-[#C9A84C]/15 bg-[#C9A84C]/5 p-4">
            <div className="flex items-center gap-3 text-sm text-[#E0E6ED]/75">
              <div className="flex shrink-0 items-center gap-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-400">
                  <ThumbsUp className="h-4 w-4" />
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-400/10 text-red-400">
                  <ThumbsDown className="h-4 w-4" />
                </span>
              </div>
              <p>
                Ваші оцінки допомагають нам швидше знаходити слабкі відповіді й покращувати юридичну якість бота.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex w-full items-center justify-center rounded-xl bg-[#C9A84C] px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-[#0A0E1A] transition-colors hover:bg-[#E2C47A]"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  )
}
