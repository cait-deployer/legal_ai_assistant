import Link from "next/link"

export function CtaSection() {
  return (
    <section className="py-32 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-[#C9A84C]/5 pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-[#C9A84C] opacity-[0.04] blur-[100px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto text-center">
        <h2 className="font-serif text-4xl sm:text-5xl font-bold text-[#E0E6ED] mb-5 text-balance leading-tight">
          Твоє питання вже чекає відповіді.
        </h2>
        <p className="text-white/45 text-lg mb-3 leading-relaxed">
          {"Зареєструйся за 30 секунд \u2014 і отримай 10 безкоштовних запитів одразу."}
        </p>

        <Link
          href="/chat"
          className="inline-flex items-center gap-2 px-10 py-5 rounded-xl text-lg font-bold bg-[#C9A84C] text-[#0A0E1A] hover:bg-[#E2C47A] transition-all duration-200 shadow-2xl shadow-[#C9A84C]/20 hover:shadow-[#C9A84C]/30 hover:-translate-y-0.5 mt-6"
        >
          Почати безкоштовно →
        </Link>

        <p className="text-white/45 text-sm mt-4">
          Без кредитної картки
        </p>
      </div>
    </section>
  )
}
