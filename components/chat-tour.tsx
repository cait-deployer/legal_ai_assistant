'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Scale, ChevronRight, ChevronLeft } from 'lucide-react'

const PADDING = 10

interface TourStep {
  target: string | null // null = welcome screen (no spotlight)
  title: string
  body: string
  position: 'right' | 'left' | 'top' | 'bottom'
  sidebarNeeded?: boolean
}

const STEPS: TourStep[] = [
  {
    target: null,
    title: 'Вітаємо в URAI!',
    body: 'Давайте за хвилину покажемо де що знаходиться і як отримати максимум від юридичного асистента.',
    position: 'bottom',
  },
  {
    target: 'new-chat',
    title: 'Нові чати та історія',
    body: 'Натисніть "Новий чат" щоб почати розмову. Всі попередні запити зберігаються в списку нижче.',
    position: 'right',
    sidebarNeeded: true,
  },
  {
    target: 'sample-questions',
    title: 'Приклади запитів',
    body: 'Натисніть на готовий приклад або одразу напишіть своє питання. Юридична термінологія не потрібна.',
    position: 'bottom',
  },
  {
    target: 'chat-input',
    title: 'Ваше питання',
    body: 'Пишіть звичайною мовою. URAI проаналізує закони та судову практику і дасть відповідь з посиланнями на першоджерела.',
    position: 'top',
  },
  {
    target: 'settings-link',
    title: 'AI-профіль та налаштування',
    body: 'Тут — ваш персональний AI-профіль і підписка. Бот вже знає вашу роль і адаптує відповіді саме для вас.',
    position: 'right',
    sidebarNeeded: true,
  },
]

const NON_WELCOME = STEPS.filter(s => s.target !== null)

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
  borderRadius: string
}

export interface ChatTourProps {
  onComplete: () => void
  onSidebarOpen: () => void
  onSidebarClose: () => void
}

export function ChatTour({ onComplete, onSidebarOpen, onSidebarClose }: ChatTourProps) {
  const [step, setStep] = useState(0)
  const [spotRect, setSpotRect] = useState<SpotRect | null>(null)
  const [tooltipPos, setTooltipPos] = useState<React.CSSProperties>({})
  const [mounted, setMounted] = useState(false)

  // Stable refs so callbacks don't re-trigger the main effect
  const onCompleteRef = useRef(onComplete)
  const onSidebarOpenRef = useRef(onSidebarOpen)
  const onSidebarCloseRef = useRef(onSidebarClose)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onSidebarOpenRef.current = onSidebarOpen }, [onSidebarOpen])
  useEffect(() => { onSidebarCloseRef.current = onSidebarClose }, [onSidebarClose])

  useEffect(() => { setMounted(true) }, [])

  const current = STEPS[step]
  const isWelcome = current.target === null
  const isLast = step === STEPS.length - 1
  const dotIndex = NON_WELCOME.findIndex(s => s.target === current.target)

  // Measure target element and compute tooltip position
  const measure = useCallback((stepIndex: number) => {
    const s = STEPS[stepIndex]
    if (!s.target) { setSpotRect(null); return true }

    const el = document.querySelector(`[data-tour="${s.target}"]`)
    if (!el) return false // element not in DOM

    const r = el.getBoundingClientRect()
    const computed = window.getComputedStyle(el)
    const rect: SpotRect = {
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
      borderRadius: computed.borderRadius || '12px',
    }
    setSpotRect(rect)

    // Tooltip position
    const TOOLTIP_W = 288
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 14
    let pos: React.CSSProperties = {}

    switch (s.position) {
      case 'right':
        pos = {
          top: Math.min(Math.max(rect.top, 16), vh - 230),
          left: Math.min(rect.left + rect.width + GAP, vw - TOOLTIP_W - 16),
        }
        break
      case 'left':
        pos = {
          top: Math.min(Math.max(rect.top, 16), vh - 230),
          left: Math.max(rect.left - TOOLTIP_W - GAP, 16),
        }
        break
      case 'top':
        pos = {
          bottom: vh - rect.top + GAP,
          left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), vw - TOOLTIP_W - 16),
        }
        break
      case 'bottom':
      default:
        pos = {
          top: Math.min(rect.top + rect.height + GAP, vh - 230),
          left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), vw - TOOLTIP_W - 16),
        }
    }
    setTooltipPos(pos)
    return true
  }, [])

  // Find next step index where the target element exists (or skip to done)
  const findNext = useCallback((from: number, dir: 1 | -1): number => {
    let i = from + dir
    while (i >= 0 && i < STEPS.length) {
      const s = STEPS[i]
      if (!s.target) return i // welcome always exists
      if (document.querySelector(`[data-tour="${s.target}"]`)) return i
      i += dir
    }
    return dir === 1 ? STEPS.length : -1
  }, [])

  // Main step-change effect
  useEffect(() => {
    if (!mounted) return
    const s = STEPS[step]

    const run = () => {
      const found = measure(step)
      if (!found && s.target) {
        // Element not in DOM — auto-skip
        const next = findNext(step, 1)
        if (next >= STEPS.length) { onSidebarCloseRef.current(); onCompleteRef.current() }
        else setStep(next)
      }
    }

    if (s.sidebarNeeded) {
      onSidebarOpenRef.current()
      const t = setTimeout(run, 340) // wait for sidebar slide-in
      return () => clearTimeout(t)
    } else {
      // Close sidebar if previous step had it open
      const prev = STEPS[step - 1]
      if (prev?.sidebarNeeded) onSidebarCloseRef.current()
      const t = setTimeout(run, 50)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mounted])

  const handleComplete = useCallback(() => {
    onSidebarCloseRef.current()
    onCompleteRef.current()
  }, [])

  const goNext = () => {
    if (isLast) { handleComplete(); return }
    const next = findNext(step, 1)
    if (next >= STEPS.length) { handleComplete(); return }
    setStep(next)
  }

  const goPrev = () => {
    const prev = findNext(step, -1)
    if (prev < 0) return
    setStep(prev)
  }

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-[9999]" role="dialog" aria-modal aria-label="Гід по URAI">
      {/* Dark backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-[#0A0E1A]/80"
      />

      {/* Spotlight cutout */}
      <AnimatePresence mode="wait">
        {spotRect && !isWelcome && (
          <motion.div
            key={`spot-${step}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed',
              top: spotRect.top,
              left: spotRect.left,
              width: spotRect.width,
              height: spotRect.height,
              borderRadius: spotRect.borderRadius,
              // The magic: box-shadow covers everything outside this box
              boxShadow: '0 0 0 9999px rgba(10, 14, 26, 0.82)',
              border: '2px solid rgba(201, 168, 76, 0.55)',
              zIndex: 10000,
              pointerEvents: 'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* Welcome modal (centered, no spotlight) */}
      {isWelcome && (
        <div className="absolute inset-0 flex items-center justify-center p-4 z-[10001]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="bg-[#0d1120] border border-[#C9A84C]/30 rounded-[2rem] p-8 max-w-sm w-full shadow-2xl shadow-black/40 text-center"
          >
            <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#C9A84C] to-[#E2C47A] flex items-center justify-center mx-auto mb-5 shadow-2xl shadow-[#C9A84C]/20">
              <Scale className="w-8 h-8 text-[#0A0E1A]" />
            </div>
            <h2 className="font-serif text-2xl font-bold text-white mb-2">Вітаємо в URAI!</h2>
            <p className="text-sm text-[#E0E6ED]/60 leading-relaxed mb-7">
              Давайте за хвилину покажемо де що знаходиться і як отримати максимум від юридичного асистента.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleComplete}
                className="flex-1 h-11 rounded-2xl border border-[#C9A84C]/20 text-[#C9A84C]/60 hover:text-[#C9A84C] hover:border-[#C9A84C]/40 text-[11px] font-black uppercase tracking-wider transition-all"
              >
                Пропустити
              </button>
              <button
                onClick={goNext}
                className="flex-[2] h-11 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                Почати тур <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Step tooltip */}
      <AnimatePresence mode="wait">
        {!isWelcome && spotRect && (
          <motion.div
            key={`tip-${step}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, delay: 0.06 }}
            style={{ position: 'fixed', width: 288, zIndex: 10001, ...tooltipPos }}
            className="bg-[#0d1120] border border-[#C9A84C]/30 rounded-[1.5rem] p-5 shadow-2xl shadow-black/50"
          >
            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mb-3">
              {NON_WELCOME.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === dotIndex ? 'w-5 bg-[#C9A84C]' : 'w-1.5 bg-[#C9A84C]/20'
                    }`}
                />
              ))}
            </div>

            <h3 className="font-serif font-bold text-[#E0E6ED] text-base mb-1.5">
              {current.title}
            </h3>
            <p className="text-xs text-[#E0E6ED]/60 leading-relaxed mb-4">
              {current.body}
            </p>

            <div className="flex items-center gap-2">
              {step > 1 && (
                <button
                  onClick={goPrev}
                  className="w-9 h-9 rounded-xl border border-[#C9A84C]/20 text-[#C9A84C]/50 hover:text-[#C9A84C] hover:border-[#C9A84C]/40 flex items-center justify-center transition-all shrink-0"
                  aria-label="Назад"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleComplete}
                className="text-[#C9A84C]/30 hover:text-[#C9A84C]/60 text-[12px] font-black uppercase tracking-wider transition-all"
              >
                Пропустити
              </button>
              <button
                onClick={goNext}
                className="ml-auto h-9 px-4 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 flex items-center gap-1.5"
              >
                {isLast ? 'Готово' : 'Далі'}
                {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
