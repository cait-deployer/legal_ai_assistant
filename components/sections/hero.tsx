"use client"

import Link from "next/link"
import Image from "next/image"

export function HeroSection() {
  return (
    <section className="relative mt-10 min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(rgba(201,168,76,1) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#C9A84C] opacity-[0.05] blur-[120px] pointer-events-none" />
      <div className="absolute left-1/4 bottom-0 w-[400px] h-[400px] rounded-full bg-[#C9A84C] opacity-[0.03] blur-[100px] pointer-events-none" />

      <div className="relative z-10 pt-10 sm:pt-16 max-w-4xl mx-auto px-4 sm:px-6 text-center">
        {/* Logo mark */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-[#C9A84C] opacity-20 blur-xl scale-110" />
            <Image
              src="/logo.jpg"
              alt="URAI"
              width={88}
              height={88}
              className="relative rounded-2xl object-cover shadow-2xl shadow-[#C9A84C]/30 border border-[#C9A84C]/25"
            />
          </div>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#C9A84C]/25 bg-[#C9A84C]/10 text-[#C9A84C] text-sm font-medium mb-8">
          ✦ Перший AI-помічник з законодавства України
        </div>

        {/* H1 */}
        <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl font-bold text-[#E0E6ED] leading-tight text-balance mb-6">
          Не знаєш що робити&nbsp;—<br />
          <span className="text-[#C9A84C]">запитай закон.</span>
        </h1>

        {/* Subtitle */}
        <p className="text-white/45 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
          {"Кожна відповідь містить пряме посилання на статтю закону \u2014 перевір сам у два кліки."}
        </p>
        <p className="text-white/45 text-base leading-relaxed max-w-xl mx-auto mb-10">
          {"Без черг. Без юриста. Без страху."}
        </p>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link
            href="/chat"
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-lg text-base font-bold bg-[#C9A84C] text-[#0A0E1A] hover:bg-[#E2C47A] transition-all duration-200 shadow-lg shadow-[#C9A84C]/20"
          >
            Спробувати безкоштовно — 10 запитів →
          </Link>
          <a
            href="#features"
            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-lg text-base font-medium border border-[#C9A84C]/25 text-[#E0E6ED] hover:border-[#C9A84C] hover:text-[#C9A84C] transition-all duration-200"
          >
            Переглянути можливості →
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-6 max-w-lg mx-auto">
          {[
            { top: "База законів", bottom: "оновлюється щодня" },
            { top: "Посилання на джерело", bottom: "у кожній відповіді" },
            { top: "Безкоштовних запитів", bottom: "для старту" },
          ].map((stat, i) => (
            <div key={i} className="text-center border-t border-[#C9A84C]/25 pt-4">
              <div className="text-[#E0E6ED] font-semibold text-sm leading-snug">{stat.top}</div>
              <div className="text-white/45 text-xs mt-1 leading-relaxed">{stat.bottom}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
