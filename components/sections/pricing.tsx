"use client"

import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { useEffect, useState } from "react"

type Benefit = {
  id: number
  category: string
  text: string
  sort_order: number
}

type PlanData = {
  id: string
  name: string
  price_uah: number
  billing_period: string
  request_limit: number | null
  benefits: Benefit[]
  features: string[]
  badge_text: string | null
  badge_color: string
  main_benefit: string | null
  button_text: string | null
  note_text: string | null
  extra_text: string | null
  sort_order: number
}

const CATEGORY_LABELS: Record<string, string> = {
  requests: "Запити",
  sources: "Джерела",
  response: "Відповідь",
}

export function PricingSection() {
  const [plans, setPlans] = useState<PlanData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/plans")
      .then(r => r.json())
      .then(setPlans)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const priceLabel = (plan: PlanData) => {
    if (plan.price_uah === 0) return { price: "0 грн", period: null }
    if (plan.billing_period === "day") return { price: `${plan.price_uah} грн`, period: "/ 1 день" }
    return { price: `${plan.price_uah} грн`, period: "/ місяць" }
  }

return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E0E6ED] mb-3 text-balance">
            Обери свій <span className="text-[#C9A84C]">тариф</span>
          </h2>
          {/* <p className="text-white/45 text-sm">
            Перші 5 запитів — без реєстрації. Після реєстрації — ще 10 запитів безкоштовно.
          </p> */}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className="h-[500px] rounded-2xl bg-[#C9A84C]/5 animate-pulse"
                style={{ animationDelay: `${i * 70}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 items-stretch">
            {plans.map((plan) => {
              const isHighlight = plan.badge_color === "gold"
              const { price, period } = priceLabel(plan)
              const benefitsByCategory = plan.benefits.reduce((acc, b) => {
                if (!acc[b.category]) acc[b.category] = []
                acc[b.category].push(b)
                return acc
              }, {} as Record<string, Benefit[]>)

              return (
                <div
                  key={plan.id}
                  /* Додано flex-col та h-full для однакової висоти */
                  className={`relative flex flex-col h-full rounded-2xl border transition-all duration-300 ${
                    isHighlight
                      ? "border-[#C9A84C] bg-[#13192B] shadow-2xl shadow-[#C9A84C]/15 ring-1 ring-[#C9A84C]/30 z-10"
                      : "bg-[#12192b] border-[#C9A84C]/25 hover:border-[#C9A84C]/50 hover:shadow-lg hover:shadow-[#C9A84C]/5"
                  }`}
                >
                  {plan.badge_text && (
                    <div
                      className={`absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold whitespace-nowrap z-20 ${
                        plan.badge_color === "gold"
                          ? "bg-[#C9A84C] text-[#0A0E1A]"
                          : "bg-[#1a2236] text-[#C9A84C] border border-[#C9A84C]/30"
                      }`}
                    >
                      {plan.badge_color !== "gold" && <span className="mr-1">◆</span>}
                      {plan.badge_text}
                    </div>
                  )}

                  {/* Header */}
                  <div className="px-6 pt-6 pb-0">
                    <h3 className={`font-serif font-bold text-lg mb-3 ${isHighlight ? "text-[#C9A84C]" : "text-[#E0E6ED]"}`}>
                      {plan.name}
                    </h3>
                    <div className="flex items-baseline gap-2 mb-5">
                      <span className={`text-3xl font-bold ${isHighlight ? "text-[#C9A84C]" : "text-[#E0E6ED]"}`}>
                        {price}
                      </span>
                      {period && (
                        <span className="text-white/45 text-xs">{period}</span>
                      )}
                    </div>
                    <div className={`h-px ${isHighlight ? "bg-[#C9A84C]/20" : "bg-[#C9A84C]/25"}`} />
                  </div>

                  {/* Features grouped by category */}
                  <div className="flex flex-col gap-4 px-6 py-6 flex-grow">
                    {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
                      const items = benefitsByCategory[cat] ?? []
                      if (items.length === 0) return null
                      return (
                        <div key={cat}>
                          <p className="text-[9px] font-black text-[#C9A84C]/40 uppercase tracking-[0.2em] mb-1.5">{catLabel}</p>
                          <ul className="space-y-1.5">
                            {items.map(b => (
                              <li key={b.id} className="flex items-start gap-2 text-xs text-white/55 leading-snug">
                                <CheckCircle2 size={13} className="text-[#C9A84C]/60 shrink-0 mt-0.5" />
                                {b.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>

                  {/* CTA Area — завжди в самому низу */}
                  <div className="space-y-3 border-t border-[#C9A84C]/25 px-6 pt-4 pb-6 mt-auto">
                    {plan.main_benefit && (
                      <div
                        className={`text-xs italic px-3 py-2.5 rounded-lg leading-tight ${
                          isHighlight
                            ? "text-[#E2C47A] bg-[#C9A84C]/10 border border-[#C9A84C]/20"
                            : "text-[#C9A84C] bg-[#C9A84C]/5 border border-[#C9A84C]/15"
                        }`}
                      >
                        → {plan.main_benefit}
                      </div>
                    )}

                    <Link
                      href="/chat"
                      className={`w-full inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                        isHighlight
                          ? "bg-[#C9A84C] text-[#0A0E1A] hover:bg-[#E2C47A] shadow-lg shadow-[#C9A84C]/25"
                          : "bg-white/[0.08] border border-[#C9A84C]/25 text-[#E0E6ED] hover:bg-[#C9A84C]/10 hover:border-[#C9A84C]"
                      }`}
                    >
                      {plan.button_text ?? "Почати"}
                    </Link>

                    {plan.note_text && (
                      <p className="text-center text-white/45 text-[10px] min-h-[1em]">{plan.note_text}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
