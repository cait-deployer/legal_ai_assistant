const rows = [
  { label: "Знає законодавство України",  chatgpt: "partial",  urai: true },
  { label: "Посилається на статтю закону", chatgpt: false,      urai: true },
  { label: "Оновлюється щодня",            chatgpt: false,      urai: true },
  { label: "Врахована судова практика",    chatgpt: false,      urai: true },
  { label: "Може вигадати відповідь",      chatgpt: "warning",  urai: "safe" },
]

function Cell({ value }: { value: boolean | "partial" | "warning" | "safe" }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold text-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        Так
      </span>
    )
  if (value === false)
    return (
      <span className="inline-flex items-center gap-1 text-red-400 font-semibold text-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        Ні
      </span>
    )
  if (value === "partial")
    return (
      <span className="inline-flex items-center gap-1 text-amber-400 font-semibold text-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Частково
      </span>
    )
  if (value === "warning")
    return (
      <span className="inline-flex items-center gap-1 text-amber-400 font-semibold text-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Так
      </span>
    )
  if (value === "safe")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold text-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        Тільки з джерел
      </span>
    )
  return null
}

export function ComparisonSection() {
  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0d1120]">
      <div className="max-w-3xl mx-auto">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-center text-[#E0E6ED] mb-3 text-balance">
          <span className="text-[#C9A84C]">ChatGPT</span> вигадує.{" "}
          <span className="text-[#C9A84C]">URAI</span> посилається.
        </h2>
        <p className="text-white/45 text-center text-sm mb-12">
          Порівняй сам — один рядок висвітлює все
        </p>

        <div className="rounded-2xl border border-[#C9A84C]/25 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-3 bg-[#12192b] border-b border-[#C9A84C]/25">
            <div className="px-5 py-3" />
            <div className="px-5 py-3 text-center font-semibold text-white/45 text-sm border-l border-[#C9A84C]/25">
              ChatGPT
            </div>
            <div className="px-5 py-3 text-center font-semibold text-[#C9A84C] text-sm border-l border-[#C9A84C]/25 bg-[#C9A84C]/5">
              URAI
            </div>
          </div>

          {rows.map((row, i) => (
            <div
              key={i}
              className={`grid grid-cols-3 border-b border-[#C9A84C]/25 last:border-b-0 ${i % 2 === 0 ? "bg-[#12192b]" : "bg-[#0d1120]"}`}
            >
              <div className="px-5 py-4 text-[#E0E6ED] text-sm font-medium">{row.label}</div>
              <div className="px-5 py-4 text-center border-l border-[#C9A84C]/25">
                <Cell value={row.chatgpt as boolean | "partial" | "warning" | "safe"} />
              </div>
              <div className="px-5 py-4 text-center border-l border-[#C9A84C]/25 bg-[#C9A84C]/[0.03]">
                <Cell value={row.urai as boolean | "partial" | "warning" | "safe"} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
