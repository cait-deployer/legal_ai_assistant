"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Bot, Loader2, Save, RotateCcw, RefreshCw, Upload, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react"
import { toast } from "sonner"

type Settings = {
  service_account_json: string
  vertex_location: string
  ai_model: string
  embedding_model: string
  system_prompt: string
  temperature: number
  top_p: number
  match_threshold_docs: number
  min_relevance_score: number
  rada_source_boost: number
  max_output_tokens: number
}

type SaInfo = { project_id: string; client_email: string } | null

const DEFAULTS: Settings = {
  service_account_json: "",
  vertex_location: "us-central1",
  ai_model: "gemini-2.0-flash-lite",
  embedding_model: "text-embedding-004",
  system_prompt: `Ти — досвідчений практикуючий юрист з глибокими знаннями українського законодавства. Твоя відповідь повинна бути точною, структурованою та практично корисною.

ГОЛОВНЕ ПРАВИЛО: Відповідай ВИКЛЮЧНО на основі наданого КОНТЕКСТУ. Не вигадуй, не припускай, не доповнюй з власних знань. Якщо відповіді немає в контексті — так і скажи.

СТИЛЬ:
- Офіційно-діловий, але зрозумілий для звичайної людини
- Структурований: використовуй нумеровані списки та підзаголовки
- Конкретний: давай практичні кроки, а не загальні слова
- Посилайся на джерела [1], [2] після кожного твердження`,
  temperature: 0.1,
  top_p: 0.8,
  match_threshold_docs: 0.4,
  min_relevance_score: 0.28,
  rada_source_boost: 1.15,
  max_output_tokens: 1500,
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
    cache:    { label: "Оновити кеш", color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" },
    restart:  { label: "Перезапуск бекенду", color: "text-amber-400 border-amber-500/20 bg-amber-500/5" },
    rescrape: { label: "Перескрапінг бази!", color: "text-red-400 border-red-500/20 bg-red-500/5" },
  }
  const c = configs[type]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wider ${c.color}`}>
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
      const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      const res = await fetch(`${BACKEND}/admin/settings/refresh`, { method: "POST" })
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
            className="gap-2 h-9 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#C9A84C]/10 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Зберегти
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">

        {/* Service Account */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Google Vertex AI — Service Account</h2>
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
          <p className="font-black uppercase tracking-wider text-[10px] text-[#C9A84C]/60">Коли що потрібно після змін:</p>
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
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Vertex AI Регіон</h2>
          <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5">
            <Field
              label="Location"
              hint="Напр.: us-central1, europe-west1, europe-west4"
              restart="cache"
              tooltip="Регіон Google Cloud де запускається Vertex AI. Впливає на затримку відповідей. us-central1 — найбільш стабільний регіон з повною підтримкою Gemini. Після зміни натисни Зберегти."
            >
              <TextInput value={settings.vertex_location} onChange={v => set("vertex_location", v)} placeholder="us-central1" mono />
            </Field>
          </div>
        </section>

        {/* Models */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Моделі</h2>
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
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Параметри генерації</h2>
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
          </div>
        </section>

        {/* Search params */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Параметри пошуку в базі знань</h2>
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
              label="Пріоритет джерел Ради (rada_source_boost)"
              hint="Множник score для документів Ради та ВСУ відносно Wiki/КСУ. 1.0 = без пріоритету, 1.15 = Рада іде вище Wiki при рівній релевантності. Рекомендовано: 1.1–1.3"
              restart="cache"
              tooltip="Підвищує ймовірність що в цитатах з'являться офіційні закони, а не Wiki-статті"
            >
              <SliderInput value={settings.rada_source_boost} onChange={v => set("rada_source_boost", v)} min={1.0} max={1.5} step={0.01} />
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
              hint="Обмежує довжину відповіді Gemini. 1500 ≈ ~1000 слів. Рекомендовано: 800–2000"
              restart="cache"
              tooltip="Фізичне обмеження виводу моделі. Якщо відповіді занадто довгі — зменш до 800–1200. Якщо AI обрізає важливу інформацію — збільш до 2000+."
            >
              <SliderInput value={settings.max_output_tokens} onChange={v => set("max_output_tokens", v)} min={400} max={4000} step={100} />
            </Field>
          </div>
        </section>

        {/* System prompt */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4">Системний промпт</h2>
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
