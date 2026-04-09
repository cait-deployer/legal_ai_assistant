"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

const faqs = [
  {
    q: "Чи є URAI офіційним державним сервісом?",
    a: "Ні. URAI — це незалежний AI-помічник. Ми не є державним органом, не представляємо ДПС, Верховну Раду чи будь-які інші владні структури. Сервіс надає інформаційні консультації на основі публічно доступного законодавства України. Для офіційних юридичних дій зверніться до ліцензованого адвоката або державного органу.",
  },
  {
    q: "Чи зберігаються мої записи?",
    a: "На безкоштовному тарифі — лише в межах сесії. На платних тарифах — повна історія зберігається у вашому особистому кабінеті та не передається третім особам.",
  },
  {
    q: "Що входить до безкоштовного тарифу?",
    a: "Перші 5 запитів — без реєстрації. Після реєстрації через email або Google — ще 10 запитів безкоштовно. Доступ до бази zakon.rada.gov.ua та legalaid.gov.ua, коротку відповідь з прямим посиланням на статтю закону.",
  },
  {
    q: "Які теми охоплює URAI?",
    a: "Податкове право, трудове право, цивільне право, права ФОПів, права військовослужбовців та їхніх сімей, захист прав споживачів, житлове законодавство, пенсії та соціальні виплати, корпоративне право та багато іншого.",
  },
  {
    q: "Звідки URAI бере інформацію?",
    a: "URAI використовує офіційні джерела: Верховна Рада (zakon.rada.gov.ua), ДПС (tax.gov.ua), Конституційний суд (ccu.gov.ua), Верховний суд (supreme.court.gov.ua), legalaid.gov.ua. На тарифі Про — також судові рішення та правові позиції ВС. Джерело завжди вказується у відповіді.",
  },
  {
    q: "Чи можна використовувати відповіді URAI у суді?",
    a: "Відповіді URAI носять інформаційний характер і не є офіційним юридичним висновком. Для судових процесів обов'язково залучайте адвоката. Посилання на джерела у відповідях допоможуть вам підготуватись.",
  },
  {
    q: "Як скасувати підписку?",
    a: "У будь-який момент через особистий кабінет. Без штрафів та прихованих умов.",
  },
]

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section id="faq" className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0d1120]">
      <div className="max-w-3xl mx-auto">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-center text-[#E0E6ED] mb-14 text-balance">
          Часті <span className="text-[#C9A84C]">запитання</span>
        </h2>

        <div className="flex flex-col gap-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="rounded-xl border border-[#C9A84C]/25 overflow-hidden transition-all duration-200 bg-[#12192b]"
            >
              <button
                className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-[#C9A84C]/[0.06] transition-colors duration-200"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                aria-expanded={openIndex === i}
              >
                <span className="font-semibold text-[#E0E6ED] text-sm pr-4">{faq.q}</span>
                <ChevronDown
                  size={18}
                  className={`text-[#C9A84C] shrink-0 transition-transform duration-200 ${openIndex === i ? "rotate-180" : ""}`}
                />
              </button>
              {openIndex === i && (
                <div className="px-6 pb-5 border-t border-[#C9A84C]/25">
                  <p className="text-white/45 text-sm leading-relaxed pt-4">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
