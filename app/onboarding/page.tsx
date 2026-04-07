"use client"

import { useState } from "react"
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

// ── Types ────────────────────────────────────────────────────────────────────
type Segment =
  | "legal_pro"
  | "business_finance"
  | "gov_sector"
  | "military_theme"
  | "social_vulnerable"
  | "daily_life"
  | "specialized_niche"

type Role = "lawyer" | "accountant" | "tax_specialist" | "business_owner" | "private_person"

// ── Data ─────────────────────────────────────────────────────────────────────
const SEGMENTS: { value: Segment; label: string; desc: string; icon: LucideIcon }[] = [
  { value: "legal_pro",         label: "Юридична сфера",      desc: "Адвокати, юристи, нотаріуси",         icon: Scale          },
  { value: "business_finance",  label: "Бізнес і фінанси",    desc: "Підприємці, бухгалтери, фінансисти",  icon: Briefcase      },
  { value: "gov_sector",        label: "Держсектор",          desc: "Держслужбовці, органи влади",         icon: Landmark       },
  { value: "military_theme",    label: "Військова тематика",  desc: "Ветерани, військовозобов'язані",      icon: Shield         },
  { value: "social_vulnerable", label: "Соціально вразливі",  desc: "Пенсіонери, особи з інвалідністю",   icon: HeartHandshake },
  { value: "daily_life",        label: "Повсякденні питання", desc: "Права споживача, ЖКГ, трудові спори", icon: Home           },
  { value: "specialized_niche", label: "Спеціалізована ніша", desc: "IT, медицина, нерухомість та інше",   icon: FlaskConical   },
]

const ROLES: { value: Role; label: string }[] = [
  { value: "lawyer",          label: "Юрист / Адвокат" },
  { value: "accountant",      label: "Бухгалтер" },
  { value: "tax_specialist",  label: "Податковий консультант" },
  { value: "business_owner",  label: "Підприємець / Власник бізнесу" },
  { value: "private_person",  label: "Приватна особа" },
]

const SUB_ROLES: Record<Segment, string[]> = {
  legal_pro:         ["Адвокат", "Нотаріус", "Юрисконсульт", "Суддя", "Прокурор", "Медіатор"],
  business_finance:  ["ФОП", "ТОВ", "Бухгалтер", "Фінансовий директор", "Аудитор"],
  gov_sector:        ["Держслужбовець", "Депутат місцевої ради", "Посадова особа"],
  military_theme:    ["Ветеран", "Військовослужбовець", "Мобілізований", "Член сім'ї ветерана"],
  social_vulnerable: ["Пенсіонер", "Особа з інвалідністю", "Малозабезпечений", "Внутрішньо переміщена особа"],
  daily_life:        ["Орендар / Власник нерухомості", "Споживач", "Працівник", "Батько / Мати"],
  specialized_niche: ["IT-спеціаліст", "Медичний працівник", "Ріелтор", "Страховий агент", "Інше"],
}

const STEP_LABELS = ["Сфера", "Роль", "Спеціалізація"]

export default function OnboardingPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [segments, setSegments] = useState<Segment[]>([])
  const [role, setRole] = useState<Role | null>(null)
  const [subRole, setSubRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const toggleSegment = (value: Segment) => {
    setSegments((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    )
  }

  const availableSubRoles = [...new Set(segments.flatMap((s) => SUB_ROLES[s]))]

  const handleFinish = async () => {
    if (segments.length === 0 || !role) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/save-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments, role, subRole }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "save_failed")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      setError(
        msg === "Server configuration error"
          ? "Помилка конфігурації сервера. Зверніться до підтримки."
          : "Помилка збереження. Спробуйте ще раз."
      )
      setLoading(false)
      return
    }
    window.location.href = "/"
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden py-8 px-4">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFA071]/3 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-[#BFA071]/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-[#BFA071]/[0.03]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.015]">
          <defs>
            <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="#BFA071" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-[500px]">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#BFA071] to-[#d4b78a] flex items-center justify-center shadow-2xl shadow-[#BFA071]/20 ring-4 ring-[#BFA071]/10">
            <Scale className="w-8 h-8 text-[#0A0E1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-serif font-bold tracking-tight text-white">
              Lawyer <span className="text-[#BFA071]">AI</span>
            </h1>
            <p className="text-sm text-[#E0E6ED]/60 mt-0.5">Налаштуємо під вас за хвилину</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-7">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1
            const done = step > n
            const active = step === n
            return (
              <div key={n} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${
                    done ? "bg-[#BFA071] text-[#0A0E1A]" : active ? "bg-[#BFA071]/20 border border-[#BFA071]/50 text-[#BFA071]" : "bg-[#BFA071]/5 border border-[#BFA071]/10 text-[#BFA071]/30"
                  }`}>
                    {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-wider transition-colors ${
                    active ? "text-[#BFA071]" : done ? "text-[#BFA071]/60" : "text-[#BFA071]/20"
                  }`}>{label}</span>
                </div>
                {i < 2 && (
                  <div className={`w-8 h-px transition-colors ${step > n ? "bg-[#BFA071]/40" : "bg-[#BFA071]/10"}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Card */}
        <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-7">

          {/* ── STEP 1 ───────────────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="mb-5">
                <p className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em] mb-1">Крок 1 з 3</p>
                <h2 className="text-lg font-serif font-bold text-white">Яка ваша основна сфера?</h2>
                <p className="text-sm text-[#E0E6ED]/50 mt-0.5">Можна обрати кілька варіантів</p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {SEGMENTS.map((s) => {
                  const Icon = s.icon
                  const selected = segments.includes(s.value)
                  return (
                    <button
                      key={s.value}
                      onClick={() => toggleSegment(s.value)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${
                        selected
                          ? "border-[#BFA071]/50 bg-[#BFA071]/8 ring-1 ring-[#BFA071]/20"
                          : "border-[#BFA071]/10 hover:border-[#BFA071]/30 hover:bg-[#BFA071]/5"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        selected ? "bg-[#BFA071]/15 border border-[#BFA071]/30" : "bg-[#BFA071]/5 border border-[#BFA071]/10"
                      }`}>
                        <Icon className={`w-4 h-4 ${selected ? "text-[#BFA071]" : "text-[#BFA071]/40"}`} strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-semibold transition-colors ${selected ? "text-white" : "text-[#E0E6ED]/70"}`}>
                          {s.label}
                        </div>
                        <div className="text-xs text-[#E0E6ED]/40 truncate">{s.desc}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                        selected ? "border-[#BFA071] bg-[#BFA071]" : "border-[#BFA071]/20"
                      }`}>
                        {selected && <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0E1A]" strokeWidth={2.5} />}
                      </div>
                    </button>
                  )
                })}
              </div>

              {segments.length > 0 && (
                <p className="text-[10px] font-black text-[#BFA071]/50 uppercase tracking-widest mt-3 text-center">
                  Обрано: {segments.length}
                </p>
              )}

              <button
                className="w-full h-14 mt-4 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                disabled={segments.length === 0}
                onClick={() => setStep(2)}
              >
                Далі <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {/* ── STEP 2 ───────────────────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <div className="mb-5">
                <p className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em] mb-1">Крок 2 з 3</p>
                <h2 className="text-lg font-serif font-bold text-white">Ваша роль</h2>
                <p className="text-sm text-[#E0E6ED]/50 mt-0.5">Відповіді будуть адаптовані до вашого рівня</p>
              </div>

              <div className="flex flex-col gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRole(r.value)}
                    className={`flex items-center justify-between px-4 py-3.5 rounded-2xl border text-left transition-all duration-150 ${
                      role === r.value
                        ? "border-[#BFA071]/50 bg-[#BFA071]/8 ring-1 ring-[#BFA071]/20"
                        : "border-[#BFA071]/10 hover:border-[#BFA071]/30 hover:bg-[#BFA071]/5"
                    }`}
                  >
                    <span className={`text-sm font-semibold transition-colors ${role === r.value ? "text-white" : "text-[#E0E6ED]/70"}`}>
                      {r.label}
                    </span>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      role === r.value ? "border-[#BFA071] bg-[#BFA071]" : "border-[#BFA071]/20"
                    }`}>
                      {role === r.value && <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0E1A]" strokeWidth={2.5} />}
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  className="h-14 flex-1 rounded-2xl border border-[#BFA071]/20 text-[#BFA071]/70 hover:border-[#BFA071]/40 hover:text-[#BFA071] hover:bg-[#BFA071]/5 font-black uppercase tracking-[0.15em] text-[11px] transition-all active:scale-95 flex items-center justify-center gap-2"
                  onClick={() => setStep(1)}
                >
                  <ChevronLeft className="w-4 h-4" /> Назад
                </button>
                <button
                  className="h-14 flex-1 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.15em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                  disabled={!role}
                  onClick={() => setStep(3)}
                >
                  Далі <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

          {/* ── STEP 3 ───────────────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <div className="mb-5">
                <p className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em] mb-1">Крок 3 з 3</p>
                <h2 className="text-lg font-serif font-bold text-white">Уточніть спеціалізацію</h2>
                <p className="text-sm text-[#E0E6ED]/50 mt-0.5">Необов&apos;язково — але допоможе точніше відповідати</p>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                {availableSubRoles.map((sr) => (
                  <button
                    key={sr}
                    onClick={() => setSubRole(subRole === sr ? null : sr)}
                    className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all duration-150 ${
                      subRole === sr
                        ? "border-[#BFA071]/50 bg-[#BFA071]/10 text-[#BFA071] ring-1 ring-[#BFA071]/20"
                        : "border-[#BFA071]/10 text-[#E0E6ED]/50 hover:border-[#BFA071]/30 hover:text-[#E0E6ED]"
                    }`}
                  >
                    {sr}
                  </button>
                ))}
              </div>

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button
                  className="h-14 flex-1 rounded-2xl border border-[#BFA071]/20 text-[#BFA071]/70 hover:border-[#BFA071]/40 hover:text-[#BFA071] hover:bg-[#BFA071]/5 font-black uppercase tracking-[0.15em] text-[11px] transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                  onClick={() => setStep(2)}
                  disabled={loading}
                >
                  <ChevronLeft className="w-4 h-4" /> Назад
                </button>
                <button
                  className="h-14 flex-1 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                  onClick={handleFinish}
                  disabled={loading}
                >
                  {loading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Збереження...</>
                    : "Розпочати"
                  }
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center mt-6 text-[10px] font-black text-[#BFA071]/30 uppercase tracking-[0.2em]">
          Lawyer AI · Юридичний асистент України
        </p>
      </div>
    </div>
  )
}
