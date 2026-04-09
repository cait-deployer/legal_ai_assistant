import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-[#C9A84C]/25 bg-[#0d1120] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
          {/* Logo & desc */}
          <div className="lg:col-span-2">
            <Link href="/" className="font-serif text-xl font-bold text-[#C9A84C] mb-3 inline-block">
              ✦ URAI
            </Link>
            <p className="text-white/45 text-sm leading-relaxed max-w-sm">
              AI-помічник для юридичних та податкових питань України. Перші 10 запитів безкоштовно.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-[#E0E6ED] font-semibold text-sm mb-4">Навігація</h4>
            <ul className="flex flex-col gap-2.5">
              {[
                { href: "/", label: "Головна" },
                { href: "/#features", label: "Можливості" },
                { href: "/#pricing", label: "Тарифи" },
                { href: "/#faq", label: "FAQ" },
                { href: "/terms", label: "Умови користування" },
                { href: "/privacy", label: "Конфіденційність" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-white/45 text-sm hover:text-[#C9A84C] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-[#E0E6ED] font-semibold text-sm mb-4">Контакти</h4>
            <a
              href="mailto:support@urai.org.ua"
              className="text-white/45 text-sm hover:text-[#C9A84C] transition-colors"
            >
              support@urai.org.ua
            </a>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="border-t border-[#C9A84C]/25 pt-8">
          <div className="flex items-start gap-2 bg-[#C9A84C]/5 border border-[#C9A84C]/25 rounded-lg p-4 mb-6">
            <span className="text-[#C9A84C] text-sm shrink-0">⚠ </span>
            <p className="text-white/45 text-xs leading-relaxed">
              URAI надає інформацію на основі законодавства України — але не замінює консультацію адвоката у складних справах. Для вирішення конкретної юридичної ситуації рекомендуємо звернутись до фахівця.
            </p>
          </div>
          <p className="text-white/45 text-xs text-center">
            © 2026 URAI. Всі права захищені. Сервіс працює відповідно до законодавства України.
          </p>
        </div>
      </div>
    </footer>
  )
}
