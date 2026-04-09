export function MissionSection() {
  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="rounded-2xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 p-10 sm:p-14 text-center relative overflow-hidden">
          {/* Subtle glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full bg-[#C9A84C] opacity-[0.04] blur-[80px] pointer-events-none" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#C9A84C]/30 bg-[#C9A84C]/10 text-[#C9A84C] text-xs font-medium mb-6 uppercase tracking-wider">
              Соціальна місія
            </div>

            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E0E6ED] mb-6 text-balance leading-tight">
              Твоє право —{" "}
              <span className="text-[#C9A84C]">тут і зараз.</span>
            </h2>

            <p className="text-white/45 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              {"Мільйони українців щороку програють справи, мовчать під тиском роботодавців або підписують невигідні договори \u2014 просто тому що не знали що саме написано в законі."}
            </p>

            <p className="text-[#C9A84C] font-semibold text-lg mt-6">
              URAI змінює це. Відповідь — за секунди.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
