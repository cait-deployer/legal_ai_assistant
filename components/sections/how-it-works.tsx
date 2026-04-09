export function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      title: "Задай питання",
      desc: "Напиши своє юридичне або податкове питання звичайною мовою",
      example: '"Мене хочуть звільнити. Чи законно це?"',
      tag: null,
    },
    {
      num: "02",
      title: "AI аналізує базу",
      desc: "URAI перевіряє тисячі законів, рішення судів та офіційних роз'яснень",
      example: null,
      tag: "КЗпП · судова практика · роз'яснення Мін'юстполітики",
    },
    {
      num: "03",
      title: "Отримай відповідь",
      desc: "Чітка відповідь з посиланням на конкретну статтю. Натисни — і відкриється офіційний текст закону на zakon.rada.gov.ua",
      example: null,
      tag: null,
    },
  ]

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0d1120]">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-center text-[#E0E6ED] mb-3 text-balance">
          Три кроки до відповіді на своє{" "}
          <span className="text-[#C9A84C]">юридичне питання</span>
        </h2>
        <p className="text-white/45 text-center mb-16 text-sm">
          Просто. Швидко. Точно.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((step, i) => (
            <div key={i} className="relative flex flex-col items-center text-center">
              {/* Connector */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-10 left-[calc(50%+40px)] right-[-50%] h-px bg-gradient-to-r from-[#C9A84C]/40 to-transparent" />
              )}

              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border-2 border-[#C9A84C] bg-[#C9A84C]/10 mb-6">
                <span className="font-serif text-2xl font-bold text-[#C9A84C]">{step.num}</span>
              </div>

              <h3 className="font-serif text-xl font-bold text-[#E0E6ED] mb-3">{step.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed max-w-xs mx-auto mb-4">{step.desc}</p>

              {step.example && (
                <div className="w-full max-w-xs bg-[#12192b] border border-[#C9A84C]/25 rounded-lg px-4 py-2.5 text-sm text-[#C9A84C] italic">
                  {step.example}
                </div>
              )}
              {step.tag && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {step.tag.split(" · ").map((t, ti) => (
                    <span key={ti} className="px-2 py-0.5 rounded-full bg-[#C9A84C]/10 border border-[#C9A84C]/20 text-[#C9A84C] text-xs">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
