"use client"

// ── Types ──────────────────────────────────────────────────────────────────────

type SourceInfo = {
  id: string
  label: string
  site: string
  siteUrl: string
  volume: string
  what: string
  why: string
  chunks: string
  truncate: string
  splitter: string
  collection: string
  color: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SOURCES_INFO: SourceInfo[] = [
  {
    id: "rada",
    label: "Верховна Рада",
    site: "zakon.rada.gov.ua",
    siteUrl: "https://zakon.rada.gov.ua",
    volume: "~15 500 документів",
    what: "Всі закони України, кодекси (ЦК, КК, КЗпП, ГПК тощо), постанови ВР, укази Президента, ратифіковані міжнародні договори. Повне первинне законодавство країни.",
    why: "Основа бази знань. Без Ради бот не знає що таке закон. Усі 13 колекцій Qdrant — це Рада, розбита по галузях (фінанси, цивільне, кримінальне тощо).",
    chunks: "3 000 символів / 300 overlap",
    truncate: "8 000 символів",
    splitter: "MarkdownTextSplitter",
    collection: "13 колекцій: rada_finance, rada_civil, rada_criminal ...",
    color: "border-blue-500/30 bg-blue-500/5",
  },
  {
    id: "kmu",
    label: "Кабінет Міністрів",
    site: "kmu.gov.ua",
    siteUrl: "https://www.kmu.gov.ua",
    volume: "~10 000+ документів",
    what: "Постанови КМУ, розпорядження, накази міністерств. Підзаконні акти виконавчої влади: порядки, правила, ліцензійні умови, тарифи, програми.",
    why: "Більшість практичних питань (ліцензії, дозволи, субсидії, соцвиплати) регулюється саме постановами КМУ, а не законами. Критично для практичних відповідей.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "MarkdownTextSplitter",
    collection: "laws_kmu_v2",
    color: "border-amber-500/30 bg-amber-500/5",
  },
  {
    id: "ccu",
    label: "Конституційний суд",
    site: "ccu.gov.ua",
    siteUrl: "https://ccu.gov.ua",
    volume: "~300–500 документів",
    what: "Рішення і висновки КСУ. Єдиний орган, що тлумачить Конституцію України та скасовує неконституційні норми.",
    why: "Коли закон чи його норма визнана неконституційною — вона не діє. Без КСУ бот може давати посилання на скасовані норми. Також КСУ дає офіційне тлумачення спірних конституційних питань.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_ccu_v2",
    color: "border-purple-500/30 bg-purple-500/5",
  },
  {
    id: "supreme",
    label: "Верховний суд",
    site: "reyestr.court.gov.ua",
    siteUrl: "https://reyestr.court.gov.ua",
    volume: "~1 000+ документів",
    what: "Постанови пленуму Верховного суду, узагальнення судової практики, роз'яснення щодо застосування законів.",
    why: "Показує як закони застосовуються на практиці. Дозволяє боту відповідати не тільки 'що каже закон' а й 'як суди це трактують'. Особливо важливо для спорів.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_supreme_v2",
    color: "border-emerald-500/30 bg-emerald-500/5",
  },
  {
    id: "wiki",
    label: "Legal Aid Wiki",
    site: "legalaid.wiki",
    siteUrl: "https://legalaid.wiki/",
    volume: "кілька тисяч статей",
    what: "Власна MediaWiki-вікі проекту Legal Aid Ukraine. Містить юридичні терміни, визначення понять, пояснення інститутів права українською мовою. Не Вікіпедія — окремий ресурс.",
    why: "Допомагає боту пояснювати терміни простою мовою. Коли користувач запитує 'що таке позовна давність?' — вікі дає чітке визначення без законодавчого жаргону.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_wiki_v2",
    color: "border-gray-500/30 bg-gray-500/5",
  },
  {
    id: "positions",
    label: "Правові позиції ВС",
    site: "lpd.court.gov.ua",
    siteUrl: "https://lpd.court.gov.ua",
    volume: "~12 800 позицій",
    what: "Каталог правових позицій Верховного суду — задокументовані висновки ВС по конкретних категоріях справ. Кожна позиція: формулювання висновку + посилання на справи.",
    why: "Найточніше джерело для відповідей типу 'яка позиція суду щодо X'. Краще за загальні постанови пленуму, бо прив'язане до конкретних обставин справ. Золото для адвокатів.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_positions_v2",
    color: "border-[#C9A84C]/30 bg-[#C9A84C]/5",
  },
  {
    id: "mod",
    label: "Міністерство оборони",
    site: "mod.gov.ua",
    siteUrl: "https://www.mod.gov.ua",
    volume: "~210 документів",
    what: "Накази, порядки та методичні матеріали МОУ з кадрової, фінансової та майнової діяльності. Завантажуються у форматі PDF через Playwright (JS-rendered сайт).",
    why: "Містить покрокові алгоритми дій, специфічні для військової служби: звільнення, грошове забезпечення, оформлення майна. Ексклюзивні дані, яких немає у Раді або КМУ.",
    chunks: "3 000 символів / 300 overlap",
    truncate: "15 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_mod_v2",
    color: "border-red-500/30 bg-red-500/5",
  },
  {
    id: "zir",
    label: "ЗІР — Держподаткова служба",
    site: "zir.tax.gov.ua",
    siteUrl: "https://zir.tax.gov.ua/main/bz/search/?src=ques",
    volume: "~5 900 питань-відповідей",
    what: "Офіційні роз'яснення Державної податкової служби у форматі Питання–Відповідь. Чинні публікації по всіх категоріях: ПДВ, ПДФО, єдиний податок, акциз, митниця тощо.",
    why: "Показує як ДПС офіційно трактує Податковий кодекс на практиці. Текст ПКУ і позиція податкової — часто різні речі. Критично для ФОПів, бухгалтерів, бізнесу.",
    chunks: "2 000 символів / 200 overlap",
    truncate: "8 000 символів",
    splitter: "RecursiveCharacterTextSplitter",
    collection: "laws_zir_v2",
    color: "border-teal-500/30 bg-teal-500/5",
  },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#E0E6ED] px-3 py-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-[#C9A84C] tracking-tight">Джерела</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">Що ми скрапимо і навіщо</p>
        </div>

        {/* Header stats */}
        <div className="bg-[#0d1120] rounded-2xl border border-[#C9A84C]/20 p-5 space-y-2">
          <p className="text-sm text-gray-400">
            База знань URAI складається з 8 джерел. Кожне джерело — окремий тип юридичної інформації
            з власним скрапером, форматом зберігання і колекцією Qdrant.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-xs text-gray-400">
            <div><span className="text-[#C9A84C] font-bold">~40 000+</span> документів загалом</div>
            <div><span className="text-[#C9A84C] font-bold">8</span> джерел скрапінгу</div>
            <div><span className="text-[#C9A84C] font-bold">20</span> колекцій Qdrant v2</div>
          </div>
        </div>

        {/* Source cards */}
        <div className="space-y-4">
          {SOURCES_INFO.map(src => (
            <div key={src.id} className={`rounded-2xl border p-5 space-y-4 ${src.color}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-[#0A0E1A]/60 text-[#C9A84C] px-2 py-0.5 rounded font-bold">{src.id}</span>
                    <h3 className="text-sm font-bold text-[#E0E6ED]">{src.label}</h3>
                  </div>
                  <a
                    href={src.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
                  >
                    {src.site} ↗
                  </a>
                </div>
                <span className="shrink-0 text-xs font-bold text-[#C9A84C] bg-[#C9A84C]/10 border border-[#C9A84C]/20 px-2 py-1 rounded-lg">
                  {src.volume}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-[12px] font-bold text-gray-400 uppercase tracking-wider">Що містить</div>
                  <p className="text-xs text-[#E0E6ED]/80 leading-relaxed">{src.what}</p>
                </div>
                <div className="space-y-1">
                  <div className="text-[12px] font-bold text-amber-500/70 uppercase tracking-wider">Навіщо боту</div>
                  <p className="text-xs text-[#E0E6ED]/80 leading-relaxed">{src.why}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-400 border-t border-white/5 pt-3">
                <span>Чанк: <b className="text-gray-400">{src.chunks}</b></span>
                <span>Truncate: <b className="text-gray-400">{src.truncate}</b></span>
                <span>Splitter: <b className="text-gray-400">{src.splitter}</b></span>
                <span>Колекція: <b className="text-gray-400">{src.collection}</b></span>
              </div>
            </div>
          ))}
        </div>

        {/* Pipeline reminder */}
        <div className="bg-[#111827] rounded-2xl border border-[#C9A84C]/10 p-5 space-y-3">
          <h3 className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider">Порядок роботи з даними</h3>
          <div className="space-y-2">
            {[
              { step: "1", label: "Скрапінг", desc: "Вкладка Скрапер — завантажує тексти на диск у /root/laws_raw/{source}/", color: "bg-blue-500/20 text-blue-300 border border-blue-500/30" },
              { step: "2", label: "Реіндекс", desc: "Вкладка Реіндекс — читає з диску, ділить на чанки, ембедить через gemini-embedding-001, завантажує у Qdrant _v2 колекції", color: "bg-amber-500/20 text-amber-300 border border-amber-500/30" },
              { step: "3", label: "Перевірка", desc: "Аналітика даних — порівнює кількість файлів на диску з кількістю векторів у Qdrant, виявляє прогалини", color: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" },
            ].map(({ step, label, desc, color }) => (
              <div key={step} className="flex gap-3 items-start">
                <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${color}`}>{step}</span>
                <div>
                  <span className="text-sm font-semibold text-[#E0E6ED]">{label}</span>
                  <span className="text-xs text-gray-400"> — {desc}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-400 border-t border-[#C9A84C]/10 pt-3">
            Правило: завжди спочатку скрапінг, потім реіндекс. Реіндекс читає файли один раз на старті — нові файли після запуску не підхоплюються.
          </div>
        </div>
      </div>
    </div>
  )
}
