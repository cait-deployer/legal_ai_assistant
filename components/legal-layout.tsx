import Link from "next/link"
import { Scale, ArrowLeft } from "lucide-react"

interface LegalLayoutProps {
  title: string
  subtitle?: string
  updatedDate: string
  children: React.ReactNode
}

export function LegalLayout({ title, subtitle, updatedDate, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      {/* Header */}
      <header className="border-b border-[#C9A84C]/15 bg-[#0d1120]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="font-serif text-lg font-bold text-[#C9A84C] hover:text-[#E2C47A] transition-colors flex items-center gap-2"
          >
            <Scale className="w-5 h-5" />
            URAI
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-white/45 hover:text-[#C9A84C] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            На головну
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-[#C9A84C]/10 bg-[#0d1120] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <p className="text-[#C9A84C] text-[12px] font-black uppercase tracking-[0.25em] mb-3">
            Юридичний документ
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#E0E6ED] mb-3">
            {title}
          </h1>
          {subtitle && (
            <p className="text-white/45 text-sm max-w-xl">{subtitle}</p>
          )}
          <p className="text-white/30 text-xs mt-4 font-medium">
            Останнє оновлення: {updatedDate}
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="prose prose-invert max-w-none space-y-10">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#C9A84C]/10 bg-[#0d1120] py-8 px-4 sm:px-6 lg:px-8 mt-10">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-xs text-center sm:text-left">
            © 2026 URAI. Всі права захищені.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-white/30 hover:text-[#C9A84C] text-xs transition-colors">
              Конфіденційність
            </Link>
            <Link href="/terms" className="text-white/30 hover:text-[#C9A84C] text-xs transition-colors">
              Умови користування
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* Reusable section primitives */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#C9A84C]/15 bg-[#0d1120] p-6 sm:p-8">
      <h2 className="font-serif text-xl font-bold text-[#C9A84C] mb-4">{title}</h2>
      <div className="text-white/55 text-sm leading-relaxed space-y-3">{children}</div>
    </section>
  )
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 mt-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="text-[#C9A84C] shrink-0 mt-0.5">▸</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
