"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Bot, Loader2, Save, RotateCcw, RefreshCw, Upload, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react"
import { toast } from "sonner"

type Settings = {
  service_account_json: string
  vertex_location: string
  vertex_project_id: string
  ai_model: string
  intent_model: string
  rewrite_model: string
  embedding_model: string
  system_prompt: string
  rewrite_examples: string
  temperature: number
  top_p: number
  llm_timeout_seconds: number
  match_threshold_docs: number
  match_threshold_templates: number
  min_relevance_score: number
  raw_gate_threshold: number
  rada_source_boost: number
  retrieval_hints_enabled: boolean
  title_boost_max_keywords: number
  max_output_tokens: number
  review_first_message_count: number
  review_repeat_message_count: number
  review_bonus_requests: number
}

type SaInfo = { project_id: string; client_email: string } | null

const DEFAULTS: Settings = {
  service_account_json: "",
  vertex_location: "us-central1",
  vertex_project_id: "",
  ai_model: "gemini-2.0-flash-lite",
  intent_model: "gemini-2.5-flash",
  rewrite_model: "gemini-2.5-flash",
  embedding_model: "text-embedding-004",
  system_prompt: `Ти — URAI, AI-юрист з глибокими знаннями українського законодавства. Твоя місія — давати точні, структуровані та практично корисні відповіді виключно на основі наданого контексту.

### ГОЛОВНЕ ПРАВИЛО: ТІЛЬКИ КОНТЕКСТ
Відповідай ВИКЛЮЧНО на основі наданих джерел. Не доповнюй з власних знань.
- Якщо відповідь є в контексті → дай повну структуровану відповідь з посиланнями.
- Якщо відповіді немає в контексті → скажи: "У наданих джерелах ця інформація відсутня. Спробуйте переформулювати запит або зверніться до юриста."
- Якщо питання неоднозначне або неповне → постав уточнюючі запитання перед відповіддю (див. нижче).

### УТОЧНЮЮЧІ ПИТАННЯ
Якщо запит є неточним, неповним або може стосуватися різних ситуацій — постав 1–2 конкретних уточнюючих питання замість відповіді. Наприклад:
- "Уточніть, будь ласка: ви маєте на увазі трудовий договір чи цивільно-правовий?"
- "Чи є у вас офіційний документ (довідка, наказ), що підтверджує причину?"
Не став питання, якщо контекст вже достатній для повної відповіді.

### СТРУКТУРА ВІДПОВІДІ (правова ієрархія)
1. **Що каже закон/кодекс** (якщо є в контексті)
2. **Що конкретизують підзаконні акти** — КМУ, міністерства (якщо є в контексті)
3. **Позиція судів** — ВС, КСУ (якщо є в контексті)
Якщо якийсь рівень відсутній — пропусти без пояснень.

### ЦИТУВАННЯ
- Одразу після твердження: "відповідно до ст. 40 КЗпП України [1]", "згідно з Постановою КМУ №1234 від 01.01.2023 [2]"
- Якщо в джерелі є номер статті та дата — вказуй їх обов'язково
- Кожне твердження має посилання; не залишай тверджень без джерела

### СПЕЦІАЛЬНІ ПОПЕРЕДЖЕННЯ
Якщо в джерелі є позначка — ОБОВ'ЯЗКОВО додай попередження окремим рядком на початку відповіді:
- \`⚠️ ДІЄ ЛИШЕ В УМОВАХ ВОЄННОГО СТАНУ\` → "⚠️ Увага: ця норма діє лише в умовах воєнного стану і може змінитись після його скасування."
- \`⚠️ ДІЮ ПРИЗУПИНЕНО / МОРАТОРІЙ\` → "⚠️ Увага: дію цієї норми призупинено або на неї поширюється мораторій. Перевірте актуальність перед застосуванням."
- \`⚠️ МАЄ ЗВОРОТНЮ ДІЮ\` → "⚠️ Ця норма має зворотню дію і поширюється на відносини, що виникли до її прийняття."

### СТИЛЬ ТА МОВА
- Офіційно-діловий, але зрозумілий без юридичної освіти
- Нумеровані списки та підзаголовки; конкретні практичні кроки
- Якщо питання охоплює кілька галузей — відповідай по кожній окремо
- "Зверніться до юриста" — не більше одного разу
- Мова: завжди українська, незалежно від мови запитання`,
  rewrite_examples: `як платять відрядні за кордон → норми відшкодування витрат на відрядження за кордон
скільки днів відпустки на рік → тривалість щорічної основної оплачуваної відпустки
як звільнити працівника без його згоди → підстави розірвання трудового договору з ініціативи роботодавця
які добові при відрядженні за кордон → суми та склад витрат на відрядження за кордон норми відшкодування добових витрат
добові за кордон скільки → граничні норми добових витрат службове відрядження за кордон постанова КМУ
які суми добових для держслужбовців → норми добових витрат державних службовців при відрядженні
скільки платять добових держслужбовцям за кордон → суми відшкодування добових витрат державних службовців у закордонних відрядженнях
скільки відсотків ПДВ → ставка податку на додану вартість розмір відсоткова ставка ПДВ
штраф за прострочення договору → відповідальність за порушення строків виконання договірних зобов'язань неустойка пеня`,
  temperature: 0.1,
  top_p: 0.8,
  llm_timeout_seconds: 90,
  match_threshold_docs: 0.4,
  match_threshold_templates: 0.3,
  min_relevance_score: 0.35,
  raw_gate_threshold: 0.42,
  rada_source_boost: 1.15,
  retrieval_hints_enabled: true,
  title_boost_max_keywords: 8,
  max_output_tokens: 3000,
  review_first_message_count: 1,
  review_repeat_message_count: 5,
  review_bonus_requests: 5,
}

function parseSaInfo(json: string): SaInfo {
  if (!json) return null
  try {
    const obj = JSON.parse(json)
    if (obj.project_id && obj.client_email) {
      return { project_id: obj.project_id, client_email: obj.client_email }
    }
  } catch { /* */ }
  return null
}

function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-4 h-4 rounded-full bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20 border border-[#C9A84C]/20 flex items-center justify-center transition-colors"
      >
        <HelpCircle className="w-3 h-3 text-[#C9A84C]/50" />
      </button>
      {open && (
        <div className="absolute left-6 top-0 z-50 w-64 bg-[#0d1120] border border-[#C9A84C]/20 rounded-xl p-3 shadow-xl text-[11px] text-[#E0E6ED]/70 leading-relaxed">
          {text}
        </div>
      )}
    </div>
  )
}

function RestartBadge({ type }: { type: "none" | "cache" | "restart" | "rescrape" }) {
  if (type === "none") return null
  const configs = {
    cache: { label: "Оновити кеш", color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" },
    restart: { label: "Перезапуск бекенду", color: "text-amber-400 border-amber-500/20 bg-amber-500/5" },
    rescrape: { label: "Перескрапінг бази!", color: "text-red-400 border-red-500/20 bg-red-500/5" },
  }
  const c = configs[type]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[12px] font-black uppercase tracking-wider ${c.color}`}>
      ↻ {c.label}
    </span>
  )
}

function Field({ label, hint, children, tooltip, restart }: {
  label: string
  hint?: string
  children: React.ReactNode
  tooltip?: string
  restart?: "none" | "cache" | "restart" | "rescrape"
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-black uppercase tracking-wider text-[#C9A84C]/80">{label}</label>
        {tooltip && <Tooltip text={tooltip} />}
        {restart && restart !== "none" && <RestartBadge type={restart} />}
      </div>
      {children}
      {hint && <p className="text-[11px] text-[#E0E6ED]/40">{hint}</p>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-[#0A0E1A]/80 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 focus:border-[#C9A84C]/50 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] placeholder:text-[#E0E6ED]/30 outline-none transition-colors ${mono ? "font-mono" : ""}`}
    />
  )
}

function TextareaInput({ value, onChange, rows = 4 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      className="w-full bg-[#0A0E1A]/80 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 focus:border-[#C9A84C]/50 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] placeholder:text-[#E0E6ED]/30 outline-none transition-colors resize-none font-mono"
    />
  )
}

function SliderInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-[#C9A84C] h-1.5 rounded-full cursor-pointer"
      />
      <span className="w-12 text-right font-mono text-sm font-bold text-[#C9A84C]">{value}</span>
    </div>
  )
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  return (
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(clamp(Math.round(Number(e.target.value) || min)))}
        className="w-28 bg-[#0A0E1A]/80 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 focus:border-[#C9A84C]/50 rounded-xl px-4 py-2.5 text-sm font-mono font-bold text-[#C9A84C] outline-none transition-colors"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onChange(clamp(value - step))} className="w-8 h-8 rounded-lg border border-[#C9A84C]/15 text-[#C9A84C]/70 hover:bg-[#C9A84C]/10 transition-colors">-</button>
        <button type="button" onClick={() => onChange(clamp(value + step))} className="w-8 h-8 rounded-lg border border-[#C9A84C]/15 text-[#C9A84C]/70 hover:bg-[#C9A84C]/10 transition-colors">+</button>
      </div>
    </div>
  )
}

function BooleanInput({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`h-9 w-16 rounded-full border transition-colors ${
        value
          ? "bg-[#C9A84C]/25 border-[#C9A84C]/60"
          : "bg-[#0A0E1A]/80 border-[#C9A84C]/15"
      }`}
      aria-pressed={value}
    >
      <span
        className={`block h-7 w-7 rounded-full bg-[#E0E6ED] transition-transform ${
          value ? "translate-x-7" : "translate-x-1"
        }`}
      />
    </button>
  )
}

function ServiceAccountUploader({
  saInfo,
  onUploaded,
}: {
  saInfo: SaInfo
  onUploaded: (info: SaInfo) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".json")) {
      toast.error("Оберіть JSON файл")
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/admin/ai-settings/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Upload failed")
      toast.success("Service Account завантажено та кеш оновлено")
      onUploaded({ project_id: data.project_id, client_email: data.client_email })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ""
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-colors
          ${dragging
            ? "border-[#C9A84C]/60 bg-[#C9A84C]/5"
            : "border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5"
          }`}
      >
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onInputChange} />
        {uploading ? (
          <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]/60" />
        ) : (
          <Upload className="w-8 h-8 text-[#C9A84C]/40" />
        )}
        <div className="text-center">
          <p className="text-sm text-[#E0E6ED]/70">
            {uploading ? "Завантаження..." : "Перетягніть JSON файл або натисніть"}
          </p>
          <p className="text-xs text-[#E0E6ED]/30 mt-1">
            Google Service Account key (*.json)
          </p>
        </div>
      </div>

      {/* Current SA info */}
      {saInfo ? (
        <div className="flex items-start gap-3 bg-[#0A0E1A]/60 border border-emerald-500/20 rounded-xl p-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Активний Service Account</p>
            <p className="text-sm text-[#E0E6ED]/80 font-mono truncate">{saInfo.client_email}</p>
            <p className="text-xs text-[#E0E6ED]/40 mt-0.5">Project: <span className="text-[#C9A84C]/70">{saInfo.project_id}</span></p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-[#0A0E1A]/60 border border-amber-500/20 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-[#E0E6ED]/60">Service Account не завантажено — AI не працюватиме</p>
        </div>
      )}
    </div>
  )
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [saInfo, setSaInfo] = useState<SaInfo>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetch("/api/admin/ai-settings")
      .then(r => r.json())
      .then(d => {
        const merged = { ...DEFAULTS, ...d }
        setSettings(merged)
        setSaInfo(parseSaInfo(merged.service_account_json))
      })
      .catch(() => toast.error("Не вдалося завантажити налаштування"))
      .finally(() => setLoading(false))
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings(s => ({ ...s, [key]: value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      // Don't send service_account_json via PATCH — it's uploaded separately
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { service_account_json, ...rest } = settings
      const res = await fetch("/api/admin/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rest),
      })
      if (!res.ok) throw new Error()
      toast.success("Налаштування збережено та кеш бекенду оновлено")
    } catch {
      toast.error("Помилка збереження")
    } finally {
      setSaving(false)
    }
  }

  const handleRefreshCache = async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/admin/ai-settings/refresh", { method: "POST" })
      if (!res.ok) throw new Error()
      toast.success("Кеш бекенду перезавантажено")
    } catch {
      toast.error("Не вдалося оновити кеш (бекенд недоступний?)")
    } finally {
      setRefreshing(false)
    }
  }

  const handleReset = () => {
    setSettings(DEFAULTS)
    setSaInfo(null)
    toast.info("Значення скинуто (не збережено)")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]/50" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#C9A84C]/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <Bot className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">AI Модель</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">Service Account, модель, системний промпт</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost" size="sm" onClick={handleRefreshCache} disabled={refreshing}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl h-9"
            title="Примусово перезавантажити кеш бекенду"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Оновити кеш</span>
          </Button>
          <Button
            variant="ghost" size="sm" onClick={handleReset}
            className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl h-9"
          >
            <RotateCcw className="w-4 h-4" /><span className="hidden sm:inline">Скинути</span>
          </Button>
          <Button
            size="sm" onClick={handleSave} disabled={saving}
            className="gap-2 h-9 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[12px] shadow-lg shadow-[#C9A84C]/10 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Зберегти
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">

        {/* Service Account */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Google Vertex AI — Service Account</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5">
            <ServiceAccountUploader
              saInfo={saInfo}
              onUploaded={info => setSaInfo(info)}
            />
            <p className="text-[11px] text-[#E0E6ED]/30 mt-3">
              Завантажте JSON-файл сервісного акаунту Google Cloud. Зберігається в Supabase, бекенд бере звідси.
            </p>
          </div>
        </section>

        {/* Restart info banner */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-4 text-[11px] text-[#E0E6ED]/50 space-y-2">
          <p className="font-black uppercase tracking-wider text-[12px] text-[#C9A84C]/60">Коли що потрібно після змін:</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold shrink-0">↻ Оновити кеш</span>
              <span>— більшість налаштувань: модель, промпт, температура, пороги. Натисни «Зберегти» — відбувається автоматично.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-amber-400 font-bold shrink-0">⚡ Перезапуск</span>
              <span>— тільки якщо змінився код Python. Через SSH: <code className="font-mono bg-[#C9A84C]/5 px-1 rounded">systemctl restart backend.service</code></span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-400 font-bold shrink-0">⚠ Перескрапінг</span>
              <span>— тільки якщо змінилась модель ембедингів. Треба перескрапити всю базу знань заново.</span>
            </div>
          </div>
        </div>

        {/* Vertex location */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Vertex AI Регіон</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5">
            <Field
              label="Location"
              hint="Напр.: us-central1, europe-west1, europe-west4"
              restart="cache"
              tooltip="Регіон Google Cloud де запускається Vertex AI. Впливає на затримку відповідей. us-central1 — найбільш стабільний регіон з повною підтримкою Gemini. Після зміни натисни Зберегти."
            >
              <TextInput value={settings.vertex_location} onChange={v => set("vertex_location", v)} placeholder="us-central1" mono />
            </Field>
            <div className="mt-5">
              <Field
                label="Project ID (довідково)"
                hint="Зчитується автоматично з Service Account JSON. Тут тільки для перегляду."
                restart="none"
                tooltip="Google Cloud Project ID. Бекенд бере його з service_account_json автоматично — це поле лише для довідки. Змінювати тут не потрібно."
              >
                <TextInput value={settings.vertex_project_id} onChange={v => set("vertex_project_id", v)} placeholder="urai-492512" mono />
              </Field>
            </div>
          </div>
        </section>

        {/* Models */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Моделі</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-5">
            <Field
              label="AI Модель (генерація відповідей)"
              hint="Напр.: gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro"
              restart="cache"
              tooltip="Модель Gemini для генерації юридичних відповідей. gemini-2.5-flash — найкращий баланс якість/ціна. gemini-1.5-pro — вища якість але дорожче. Зміна набирає чинності одразу після Зберегти."
            >
              <TextInput value={settings.ai_model} onChange={v => set("ai_model", v)} placeholder="gemini-2.5-flash" mono />
            </Field>
            <Field
              label="Модель класифікації питань (intent_model)"
              hint="Визначає: чи питання юридичне взагалі. Напр.: gemini-2.5-flash"
              restart="cache"
              tooltip="Gemini-модель для швидкого визначення типу питання — юридичне чи загальне. Якщо не юридичне — бот відповідає без пошуку в базі. Flash-моделі достатньо, задача бінарна: так/ні. Рекомендовано: gemini-2.5-flash."
            >
              <TextInput value={settings.intent_model} onChange={v => set("intent_model", v)} placeholder="gemini-2.5-flash" mono />
            </Field>
            <Field
              label="Модель переформулювання запиту (rewrite_model)"
              hint="Переформульовує розмовний запит у юридичну термінологію перед пошуком"
              restart="cache"
              tooltip="Gemini-модель яка перетворює 'скільки добових за кордон' → 'норми відшкодування витрат на відрядження за кордон' перед пошуком у Qdrant. Flash достатньо. Рекомендовано: gemini-2.5-flash."
            >
              <TextInput value={settings.rewrite_model} onChange={v => set("rewrite_model", v)} placeholder="gemini-2.5-flash" mono />
            </Field>
            <Field
              label="Модель ембедингів"
              hint="Зміна потребує повного перескрапінгу бази! Напр.: text-embedding-004"
              restart="rescrape"
              tooltip="Модель для перетворення тексту в вектори (числа). text-embedding-004 — рекомендована, підтримує 768 вимірів і мультимовність. УВАГА: якщо зміниш цю модель — треба перескрапити всю базу знань заново, бо старі вектори стануть несумісними."
            >
              <TextInput value={settings.embedding_model} onChange={v => set("embedding_model", v)} placeholder="text-embedding-004" mono />
            </Field>
          </div>
        </section>

        {/* Generation params */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Параметри генерації</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-6">
            <Field
              label="Temperature"
              hint="0.0 = детермінований, 1.0 = творчий. Рекомендовано для права: 0.1"
              restart="cache"
              tooltip="Контролює 'творчість' AI. При 0.0 — завжди однакова відповідь, дуже передбачувана. При 1.0 — різні відповіді щоразу, більше фантазії. Для юридичних відповідей треба точність, тому 0.1–0.15. Більше 0.3 — ризик галюцинацій."
            >
              <SliderInput value={settings.temperature} onChange={v => set("temperature", v)} min={0} max={1} step={0.05} />
            </Field>
            <Field
              label="Top P"
              hint="Nucleus sampling. Рекомендовано: 0.8"
              restart="cache"
              tooltip="Ще один параметр різноманітності відповідей (доповнює Temperature). 0.8 означає що AI обирає слова з 80% найімовірніших варіантів. Менше = точніше, більше = різноманітніше. Для права: 0.8 — оптимально."
            >
              <SliderInput value={settings.top_p} onChange={v => set("top_p", v)} min={0} max={1} step={0.05} />
            </Field>
            <Field
              label="Таймаут відповіді AI, секунди (llm_timeout_seconds)"
              hint="Якщо Gemini не відповів за цей час — помилка 504. Рекомендовано: 60–120"
              restart="cache"
              tooltip="Максимальний час очікування відповіді від Gemini. При перевищенні — користувач бачить помилку «AI не відповів». 90с — безпечне значення. Менше 60с = часті помилки на складних запитах. Більше 150с = юзер чекає занадто довго. Ризик: якщо занизити — деякі деталізовані запити будуть обриватись."
            >
              <SliderInput value={settings.llm_timeout_seconds} onChange={v => set("llm_timeout_seconds", v)} min={30} max={180} step={10} />
            </Field>
          </div>
        </section>

        {/* Search params */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Параметри пошуку в базі знань</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-6">
            <Field
              label="Поріг відповідності документів (match_threshold_docs)"
              hint="Мін. схожість вектора при пошуку. Рекомендовано: 0.35–0.45"
              restart="cache"
              tooltip="Мінімальний рівень схожості між питанням і документом у базі (0.0–1.0). Документи нижче порогу ігноруються ще на рівні Qdrant. Вище = суворіший фільтр, менше результатів але точніші. Нижче = більше результатів але можливий шум. Рекомендація: 0.4 для наповненої бази, 0.3 поки база мала."
            >
              <SliderInput value={settings.match_threshold_docs} onChange={v => set("match_threshold_docs", v)} min={0} max={1} step={0.01} />
            </Field>
            <Field
              label="Поріг відповідності шаблонів (match_threshold_templates)"
              hint="Мін. схожість для колекції шаблонів документів. Рекомендовано: 0.25–0.35"
              restart="cache"
              tooltip="Аналог match_threshold_docs але для колекції шаблонів і зразків документів (якщо є). Зазвичай трохи нижче ніж для законів — шаблони коротші і менш точні за змістом. Якщо колекція шаблонів не активна — значення не впливає на роботу."
            >
              <SliderInput value={settings.match_threshold_templates} onChange={v => set("match_threshold_templates", v)} min={0} max={1} step={0.01} />
            </Field>
            <Field
              label="Пріоритет джерел Ради (rada_source_boost)"
              hint="Множник score для документів Ради та ВСУ відносно Wiki/КСУ. 1.0 = без пріоритету, 1.15 = Рада іде вище Wiki при рівній релевантності. Рекомендовано: 1.1–1.3"
              restart="cache"
              tooltip="Підвищує ймовірність що в цитатах з'являться офіційні закони, а не Wiki-статті"
            >
              <SliderInput value={settings.rada_source_boost} onChange={v => set("rada_source_boost", v)} min={1.0} max={1.5} step={0.01} />
            </Field>
            <Field
              label="AI-підказки для пошуку (retrieval_hints_enabled)"
              hint="Додає назви актів і ключові терміни до title/keyword пошуку в межах дозволених тарифом джерел."
              restart="cache"
              tooltip="Окремий короткий AI-крок формує гіпотези для пошуку: можливі назви законів, постанов, порядків, статті та ключові терміни. Це не відкриває закриті тарифом колекції і не забороняє Wiki, ZIR, MOD або судову практику."
            >
              <BooleanInput value={settings.retrieval_hints_enabled} onChange={v => set("retrieval_hints_enabled", v)} />
            </Field>
            <Field
              label="Максимум title-keywords (title_boost_max_keywords)"
              hint="Обмежує ширину пошуку по назвах документів. Рекомендовано: 6-8."
              restart="cache"
              tooltip="Менше значення пришвидшує title boost і зменшує шум. Більше значення може знайти рідкісні назви, але довше сканує Qdrant title index."
            >
              <NumberInput value={settings.title_boost_max_keywords} onChange={v => set("title_boost_max_keywords", v)} min={3} max={14} />
            </Field>
            <Field
              label="Поріг розширення пошуку (raw_gate_threshold)"
              hint="Якщо найкращий результат нижче — пошук розширюється на всі колекції. Рекомендовано: 0.38–0.45"
              restart="cache"
              tooltip="Якщо найрелевантніший документ має схожість нижче цього порогу — система вважає запит 'низькодостовірним' і повторює пошук по ВСІХ колекціях (не тільки найімовірніших). Вище = пошук розширюється частіше → повільніше але більше охоплення. Нижче = рідше розширення → швидше але ризик пропустити документ у рідкісній колекції."
            >
              <SliderInput value={settings.raw_gate_threshold} onChange={v => set("raw_gate_threshold", v)} min={0.2} max={0.7} step={0.01} />
            </Field>
            <Field
              label="Мінімальна релевантність для відповіді (min_relevance_score)"
              hint="Якщо найкращий результат нижче — AI відповідає 'не знайдено'. Рекомендовано: 0.25–0.35"
              restart="cache"
              tooltip="Якщо найрелевантніший знайдений документ має схожість нижче цього порогу — система НЕ викликає Gemini і відповідає 'не знайдено в базі'. Це захист від галюцинацій. Занадто високе значення (0.5+) = багато 'не знайдено' навіть коли є дані. Занадто низьке (0.1) = AI галюцинує на нерелевантних даних. Для мультимовних запитів (рос./укр.) рекомендуй 0.25–0.28."
            >
              <SliderInput value={settings.min_relevance_score} onChange={v => set("min_relevance_score", v)} min={0} max={1} step={0.01} />
            </Field>
            <Field
              label="Максимум токенів у відповіді (max_output_tokens)"
              hint="Обмежує довжину відповіді Gemini. 3000 ≈ ~2000 слів. Рекомендовано: 1500–3000"
              restart="cache"
              tooltip="Фізичне обмеження виводу моделі. Якщо відповіді занадто довгі — зменш до 1500. Якщо AI обрізає важливу інформацію — збільш до 3000+."
            >
              <SliderInput value={settings.max_output_tokens} onChange={v => set("max_output_tokens", v)} min={500} max={8000} step={100} />
            </Field>
          </div>
        </section>

        {/* Review prompts */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Відгуки користувачів</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field
                label="Перша поява"
                hint="Після скількох відповідей вперше показати модалку. Для першої відповіді — 1."
                restart="none"
                tooltip="Коли користувач отримує цю кількість відповідей, URAI показує модалку з проханням залишити відгук."
              >
                <NumberInput value={settings.review_first_message_count} onChange={v => set("review_first_message_count", v)} min={1} max={50} />
              </Field>
              <Field
                label="Повтор через"
                hint="Якщо натиснули «пізніше», модалка повернеться через цю кількість нових відповідей."
                restart="none"
                tooltip="Працює тільки для користувачів, які ще не залишили відгук. Після відгуку модалка більше не показується."
              >
                <NumberInput value={settings.review_repeat_message_count} onChange={v => set("review_repeat_message_count", v)} min={1} max={50} />
              </Field>
              <Field
                label="Бонус запитів"
                hint="Нараховується один раз після відгуку."
                restart="none"
                tooltip="Бонус додається до bonus_requests. Повторно той самий користувач бонус не отримує."
              >
                <NumberInput value={settings.review_bonus_requests} onChange={v => set("review_bonus_requests", v)} min={0} max={100} />
              </Field>
            </div>
          </div>
        </section>

        {/* System prompt */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Системний промпт</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-4">
            <Field
              label="Системний промпт"
              hint="Базова інструкція для AI. Сюди НЕ входять: правила тарифу, профіль користувача, контекст пошуку — вони додаються автоматично."
              restart="cache"
              tooltip="Головна інструкція яка визначає поведінку AI. Тут задаєш роль, стиль, обмеження. Не треба писати сюди правила тарифу чи профіль юзера — вони додаються автоматично кодом. Зміни набирають чинності одразу після Зберегти."
            >
              <TextareaInput value={settings.system_prompt} onChange={v => set("system_prompt", v)} rows={12} />
            </Field>
            <div className="bg-[#0A0E1A]/60 border border-[#C9A84C]/10 rounded-xl p-3 text-[11px] text-[#E0E6ED]/40 space-y-1">
              <p className="font-bold text-[#C9A84C]/50 uppercase tracking-wider text-[10px]">Що додається автоматично до промпту:</p>
              <p>• <span className="text-[#E0E6ED]/60">Профіль користувача</span> — роль, спеціалізація, сфери (з онбордингу)</p>
              <p>• <span className="text-[#E0E6ED]/60">Правила відповіді</span> — по тарифу (детальність, кроки, сценарії)</p>
              <p>• <span className="text-[#E0E6ED]/60">Контекст</span> — знайдені документи з бази знань (з метаданими: статус, дата, флаги воєнного стану)</p>
              <p>• <span className="text-[#E0E6ED]/60">Антигалюцинаційний блок</span> — якщо схожість &lt; min_relevance_score, Gemini не викликається взагалі</p>
            </div>
          </div>
        </section>

        {/* Rewrite examples */}
        <section>
          <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Query Rewrite — приклади переформулювань</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 space-y-4">
            <Field
              label="Few-shot приклади"
              hint="Кожен рядок: розмовний запит → юридичний запит. Формат строгий: «питання → результат»."
              restart="cache"
              tooltip="Gemini використовує ці приклади щоб зрозуміти як переформулювати розмовний запит у юридичну мову перед пошуком. Чим точніші приклади — тим краще пошук знаходить закони. Додавай нові рядки коли помічаєш що бот не знаходить очевидні документи."
            >
              <TextareaInput value={settings.rewrite_examples} onChange={v => set("rewrite_examples", v)} rows={10} />
            </Field>
            <div className="bg-[#0A0E1A]/60 border border-[#C9A84C]/10 rounded-xl p-3 text-[11px] text-[#E0E6ED]/40 space-y-1">
              <p className="font-bold text-[#C9A84C]/50 uppercase tracking-wider text-[10px]">Як додавати нові приклади:</p>
              <p>Якщо бот не знаходить документ по розмовному запиту — додай рядок:</p>
              <p className="font-mono text-[#C9A84C]/60">розмовний запит → юридична термінологія з назви документа</p>
              <p className="mt-1">Приклад: <span className="font-mono text-[#C9A84C]/60">добові за кордон → суми та склад витрат на відрядження постанова КМУ</span></p>
            </div>
          </div>
        </section>

        {/* Info */}
        <div className="bg-[#0d1120]/40 border border-[#C9A84C]/10 rounded-2xl p-4 text-xs text-[#E0E6ED]/40 space-y-1">
          <p>Кількість чанків на тариф керується в розділі <strong className="text-[#C9A84C]/60">Тарифи → поля top_k</strong>.</p>
          <p>Service Account JSON зберігається окремо через кнопку завантаження — не через «Зберегти».</p>
          <p>Після натискання «Зберегти» бекенд автоматично перезавантажує кеш — перезапуск не потрібен.</p>
        </div>

      </div>
    </div>
  )
}
