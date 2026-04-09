import { BookOpen, RefreshCw, Link2, MessageCircle, ClipboardList, ShieldCheck } from "lucide-react"

const features = [
  {
    icon: BookOpen,
    title: "Актуальна база законів",
    desc: "Податковий кодекс, Цивільний, Кримінальний, КЗпП, ЦПК та 500+ нормативних актів. Оновлюється щодня автоматично.",
  },
  {
    icon: RefreshCw,
    title: "База оновлюється в реальному часі",
    desc: "Нові закони, поправки та роз'яснення МЮУ/МІНФІН потрапляють до бази протягом 24 годин.",
  },
  {
    icon: Link2,
    title: "Посилання на джерела",
    desc: "Кожна відповідь містить посилання на офіційне джерело: Верховна Рада, ДПС, суди.",
  },
  {
    icon: MessageCircle,
    title: "Природна мова",
    desc: "Питайте як людина — не потрібно знати юридичну термінологію.",
  },
  {
    icon: ClipboardList,
    title: "Історія запитів",
    desc: "Зберігайте та переглядайте свої попередні консультації в особистому кабінеті.",
  },
  {
    icon: ShieldCheck,
    title: "Конфіденційно",
    desc: "Ваші записи не передаються третім особам та захищені відповідно до законів України.",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-center text-[#E0E6ED] mb-3 text-balance">
          Що вміє <span className="text-[#C9A84C]">URAI</span>?
        </h2>
        <p className="text-white/45 text-center mb-16 text-sm">
          Повний набір інструментів для юридичних консультацій
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="group p-6 rounded-xl border border-[#C9A84C]/25 hover:border-[#C9A84C]/60 hover:-translate-y-1 transition-all duration-300 bg-[#12192b]"
            >
              <div className="w-10 h-10 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center mb-4 group-hover:bg-[#C9A84C]/20 transition-colors">
                <f.icon size={20} className="text-[#C9A84C]" />
              </div>
              <h3 className="font-semibold text-[#E0E6ED] text-base mb-2">{f.title}</h3>
              <p className="text-white/45 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
