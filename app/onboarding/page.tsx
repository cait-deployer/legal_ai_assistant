"use client"

export const dynamic = 'force-dynamic'

import { useEffect, useState, Suspense } from "react"
import {
  Scale,
  Loader2,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Briefcase,
  Landmark,
  Shield,
  HeartHandshake,
  Home,
  FlaskConical,
  AlertCircle,
  type LucideIcon,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

// Мапа іконок для динамічного рендеру
const ICON_MAP: Record<string, LucideIcon> = {
  Scale, Briefcase, Landmark, Shield, HeartHandshake, Home, FlaskConical
}

interface OnboardingOption {
  id: string
  step_key: string
  value: string
  label: string
  description: string | null
  icon: string | null
  parent_value: string | null
}

interface OnboardingStep {
  step_key: string
  title: string
  subtitle: string
  order_index: number
}

function OnboardingContent() {
  // Дані з бази
  const [steps, setSteps] = useState<OnboardingStep[]>([])
  const [options, setOptions] = useState<OnboardingOption[]>([])

  // Стан інтерфейсу
  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selections, setSelections] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saveLoading, setSaveLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient()
      try {
        // Завантажуємо структуру кроків та всі опції
        const [stepsRes, optionsRes] = await Promise.all([
          supabase.from("onboarding_steps").select("*").eq("is_active", true).order("order_index"),
          supabase.from("onboarding_options").select("*").eq("is_active", true).order("order_index")
        ])

        if (stepsRes.error) throw stepsRes.error
        if (optionsRes.error) throw optionsRes.error

        setSteps(stepsRes.data || [])
        setOptions(optionsRes.data || [])
      } catch (err) {
        setError("Помилка конфігурації. Перевірте з'єднання.")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const currentStep = steps[currentStepIdx]
  if (!currentStep && !loading) return null

  // Фільтрація опцій з урахуванням виборів на попередніх кроках
  const currentOptions = options.filter(opt => {
    if (opt.step_key !== currentStep.step_key) return false
    if (!opt.parent_value) return true

    // Перевіряємо залежність від попередніх кроків (наприклад, спеціалізація від ролі)
    return Object.values(selections).some(val =>
      Array.isArray(val) ? val.includes(opt.parent_value) : val === opt.parent_value
    )
  })

  const handleSelect = (val: string) => {
    const key = currentStep.step_key
    const isMulti = key === "segments"

    setSelections(prev => {
      if (isMulti) {
        const current = prev[key] || []
        return {
          ...prev,
          [key]: current.includes(val) ? current.filter((v: string) => v !== val) : [...current, val]
        }
      }
      return { ...prev, [key]: val }
    })
  }

  const handleFinish = async () => {
    setSaveLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/save-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selections),
      })
      if (!res.ok) throw new Error("save_failed")

      // Record IP / geo / UA / fingerprint after onboarding (works for Google + email)
      fetch("/api/auth/login-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: btoa(`${navigator.userAgent}-${screen.width}x${screen.height}`).slice(0, 64),
        }),
      }).catch(() => {})

      window.location.href = "/"
    } catch (err) {
      setError("Помилка збереження. Спробуйте ще раз.")
      setSaveLoading(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="w-12 h-12 animate-spin text-[#C9A84C]" />
      <p className="text-[#C9A84C] font-black uppercase tracking-[0.3em] text-[10px]">Завантаження...</p>
    </div>
  )

  const isLastStep = currentStepIdx === steps.length - 1
  const hasSelection = selections[currentStep.step_key]?.length > 0

  return (
    <div className="relative z-10 w-full max-w-[500px]">
      {/* ── Logo (З твого оригінального дизайну) ── */}
      <div className="flex flex-col items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#C9A84C] to-[#E2C47A] flex items-center justify-center shadow-2xl shadow-[#C9A84C]/20 ring-4 ring-[#C9A84C]/10">
          <Scale className="w-8 h-8 text-[#0A0E1A]" />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-serif font-bold tracking-tight text-white">
            Lawyer <span className="text-[#C9A84C]">AI</span>
          </h1>
          <p className="text-sm text-[#E0E6ED]/60 mt-0.5">Налаштуємо під вас за хвилину</p>
        </div>
      </div>

      {/* ── Step indicator (Твій оригінальний степер) ── */}
      <div className="flex items-center justify-center gap-2 mb-7">
        {steps.map((s, i) => {
          const n = i + 1
          const done = currentStepIdx > i
          const active = currentStepIdx === i
          return (
            <div key={s.step_key} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${done ? "bg-[#C9A84C] text-[#0A0E1A]" : active ? "bg-[#C9A84C]/20 border border-[#C9A84C]/50 text-[#C9A84C]" : "bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[#C9A84C]/30"
                  }`}>
                  {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
                </div>
                <span className={`text-[10px] font-black uppercase tracking-wider transition-colors ${active ? "text-[#C9A84C]" : done ? "text-[#C9A84C]/60" : "text-[#C9A84C]/20"
                  }`}>
                  {s.step_key === 'segments' ? 'Сфера' : s.step_key === 'roles' ? 'Роль' : 'Спеціалізація'}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px transition-colors ${currentStepIdx > i ? "bg-[#C9A84C]/40" : "bg-[#C9A84C]/10"}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Card (Твій оригінальний стиль) ── */}
      <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#C9A84C]/20 rounded-[2.5rem] shadow-2xl p-7">
        <div className="mb-5">
          <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em] mb-1">Крок {currentStepIdx + 1} з {steps.length}</p>
          <h2 className="text-lg font-serif font-bold text-white">{currentStep.title}</h2>
          <p className="text-sm text-[#E0E6ED]/50 mt-0.5">{currentStep.subtitle}</p>
        </div>

        {/* Динамічна сітка варіантів */}
        <div className="grid grid-cols-1 gap-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
          {currentOptions.length > 0 ? currentOptions.map((opt) => {
            const Icon = ICON_MAP[opt.icon || ""] || Scale
            const isSelected = Array.isArray(selections[currentStep.step_key])
              ? selections[currentStep.step_key].includes(opt.value)
              : selections[currentStep.step_key] === opt.value

            return (
              <button
                key={opt.id}
                onClick={() => handleSelect(opt.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${isSelected
                    ? "border-[#C9A84C]/50 bg-[#C9A84C]/8 ring-1 ring-[#C9A84C]/20"
                    : "border-[#C9A84C]/10 hover:border-[#C9A84C]/30 hover:bg-[#C9A84C]/5"
                  }`}
              >
                {opt.icon && (
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-[#C9A84C]/15 border border-[#C9A84C]/30" : "bg-[#C9A84C]/5 border border-[#C9A84C]/10"
                    }`}>
                    <Icon className={`w-4 h-4 ${isSelected ? "text-[#C9A84C]" : "text-[#C9A84C]/40"}`} strokeWidth={1.75} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold transition-colors ${isSelected ? "text-white" : "text-[#E0E6ED]/70"}`}>
                    {opt.label}
                  </div>
                  {opt.description && <div className="text-xs text-[#E0E6ED]/40 truncate">{opt.description}</div>}
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? "border-[#C9A84C] bg-[#C9A84C]" : "border-[#C9A84C]/20"
                  }`}>
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0E1A]" strokeWidth={2.5} />}
                </div>
              </button>
            )
          }) : (
            <div className="py-10 text-center opacity-30 text-xs uppercase tracking-widest">Немає доступних варіантів</div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mt-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Навігація */}
        <div className="flex gap-3 mt-5">
          {currentStepIdx > 0 && (
            <button
              className="h-14 flex-1 rounded-2xl border border-[#C9A84C]/20 text-[#C9A84C]/70 hover:border-[#C9A84C]/40 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 font-black uppercase tracking-[0.15em] text-[11px] transition-all active:scale-95 flex items-center justify-center gap-2"
              onClick={() => setCurrentStepIdx(prev => prev - 1)}
              disabled={saveLoading}
            >
              <ChevronLeft className="w-4 h-4" /> Назад
            </button>
          )}

          <button
            className="h-14 flex-[2] rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.15em] text-[11px] shadow-lg shadow-[#C9A84C]/10 transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
            disabled={!hasSelection || saveLoading}
            onClick={isLastStep ? handleFinish : () => setCurrentStepIdx(prev => prev + 1)}
          >
            {saveLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Збереження...</>
            ) : isLastStep ? (
              "Розпочати"
            ) : (
              <>Далі <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>

      <p className="text-center mt-6 text-[10px] font-black text-[#C9A84C]/30 uppercase tracking-[0.2em]">
        URAI · Юридичний асистент України
      </p>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden py-8 px-4">
      {/* ── Background (Твій оригінальний фон) ── */}
      <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#C9A84C]/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#C9A84C]/3 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-[#C9A84C]/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-[#C9A84C]/[0.03]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.015]">
          <defs>
            <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="#C9A84C" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      <Suspense fallback={<Loader2 className="animate-spin text-[#C9A84C]" />}>
        <OnboardingContent />
      </Suspense>
    </div>
  )
}