"use client"

import { useState } from "react"
import { Sword, Briefcase, Scale, Home, BookOpen, HeartHandshake } from "lucide-react"
import type { LucideIcon } from "lucide-react"

const cards: { icon: LucideIcon; title: string; desc: string; queries: string[] }[] = [
  {
    icon: Sword,
    title: "Військовослужбовці та їхні сім'ї",
    desc: "Служиш або чекаєш вдома — знай свої права. Мобілізація, виплати, статус учасника бойових дій, права при пораненні, пільги для сімей загиблих — URAI знає відповідь і дає її одразу.",
    queries: [
      "Які виплати належать мобілізованому ФОПу?",
      "Як отримати статус УБД?",
      "Що робити якщо затримують виплату грошового забезпечення?",
    ],
  },
  {
    icon: Briefcase,
    title: "ФОПи",
    desc: "Прийшов аудит? Перевірка? Не розумієш закон? РРО, ЄСВ, єдиний податок, іноземні клієнти, перевищення ліміту доходу — URAI пояснить простою мовою що це означає саме для тебе.",
    queries: [
      "Чи потрібен мені РРО якщо я надаю послуги онлайн?",
      "Що буде якщо я перевищу ліміт 3 групи?",
      "Як оформити працівника як ФОП?",
    ],
  },
  {
    icon: Scale,
    title: "Трудові спори",
    desc: "Роботодавець порушує твої права — не мовчи. Незаконне звільнення, невиплата зарплати, примус працювати понаднормово — КЗпП захищає тебе. URAI покаже як саме.",
    queries: [
      "Мене звільнили без попередження — це законно?",
      "Роботодавець не платить зарплату 2 місяці — що робити?",
      "Можуть мені відмовити у відпустці?",
    ],
  },
  {
    icon: Home,
    title: "Житлові та споживчі питання",
    desc: "Орендодавець підвищив ціну або виганяє? Магазин відмовляє у поверненні товару? Сусіди заливають? URAI знайде норму і пояснить що ти можеш зробити прямо зараз.",
    queries: [
      "Чи може орендодавець виселити мене без суду?",
      "Магазин відмовляє повернути товар — як діяти?",
      "Які права має покупець при поломці нового товару?",
    ],
  },
  {
    icon: BookOpen,
    title: "Студенти-юристи та початківці",
    desc: "Знають теорію — але губляться в практиці? Знайти потрібну норму серед тисяч законів, перевірити чи не змінилась редакція, зв'язати ЦКУ з судовою практикою — на це йдуть години. URAI робить це за секунди.",
    queries: [
      "Яка відповідальність за порушення ст. 651 ЦКУ?",
      "Як пов'язані ЗУ 'Про захист прав споживача' і ЦКУ?",
      "Яка остання редакція статті 651 ЦКУ?",
    ],
  },
  {
    icon: HeartHandshake,
    title: "Пенсіонери та соціальні виплати",
    desc: "Незрозуміло як оформити субсидію? Відмовили у пільзі? Перерахували пенсію неправильно? URAI пояснить на якій підставі і що робити далі.",
    queries: [
      "Як оформити субсидію якщо я ВПО?",
      "Мені відмовили у пільзі — це законно?",
      "Коли перераховується пенсія після підвищення мінімалки?",
    ],
  },
]

export function ForWhoSection() {
  const [active, setActive] = useState<number | null>(null)

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-4">
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#E0E6ED] mb-3 text-balance">
            Хто і в якій ситуації звертається до{" "}
            <span className="text-[#C9A84C]">URAI</span>?
          </h2>
          <p className="text-white/45 text-base max-w-xl mx-auto">
            {"Не важливо хто ти \u2014 важливо що ти опинився в ситуації де потрібна юридична відповідь прямо зараз."}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-14">
          {cards.map((card, i) => (
            <button
              key={i}
              onClick={() => setActive(active === i ? null : i)}
              className="group text-left p-6 rounded-xl border border-[#C9A84C]/25 hover:border-[#C9A84C] bg-[#12192b] hover:bg-[#C9A84C]/[0.06] transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center mb-4 group-hover:bg-[#C9A84C]/20 transition-colors">
                <card.icon size={20} className="text-[#C9A84C]" />
              </div>
              <h3 className="font-serif text-lg font-bold text-[#C9A84C] mb-2 leading-snug">{card.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed mb-4">{card.desc}</p>

              {active === i && (
                <ul className="flex flex-col gap-2 border-t border-[#C9A84C]/25 pt-4">
                  {card.queries.map((q, qi) => (
                    <li key={qi} className="flex items-start gap-2 text-xs text-white/45">
                      <span className="text-[#C9A84C] shrink-0 mt-0.5">▸</span>
                      <span className="italic">&ldquo;{q}&rdquo;</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className={`mt-3 text-xs font-medium transition-colors ${active === i ? "text-[#C9A84C]" : "text-white/45 group-hover:text-[#C9A84C]"}`}>
                {active === i ? "Згорнути ↑" : "Приклади запитів →"}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
