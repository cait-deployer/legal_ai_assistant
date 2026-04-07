"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Bot, Loader2, Save, RotateCcw, RefreshCw, Upload, CheckCircle2, AlertCircle, X } from "lucide-react"
import { toast } from "sonner"

type Settings = {
  service_account_json: string
  vertex_location: string
  ai_model: string
  embedding_model: string
  system_prompt: string
  temperature: number
  top_p: number
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-black uppercase tracking-wider text-[#BFA071]/80">{label}</label>
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
      className={`w-full bg-[#0A0E1A]/80 border border-[#BFA071]/15 hover:border-[#BFA071]/30 focus:border-[#BFA071]/50 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] placeholder:text-[#E0E6ED]/30 outline-none transition-colors ${mono ? "font-mono" : ""}`}
    />
  )
}

function TextareaInput({ value, onChange, rows = 4 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      className="w-full bg-[#0A0E1A]/80 border border-[#BFA071]/15 hover:border-[#BFA071]/30 focus:border-[#BFA071]/50 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] placeholder:text-[#E0E6ED]/30 outline-none transition-colors resize-none font-mono"
    />
  )
}

function SliderInput({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-[#BFA071] h-1.5 rounded-full cursor-pointer"
      />
      <span className="w-12 text-right font-mono text-sm font-bold text-[#BFA071]">{value}</span>
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
            ? "border-[#BFA071]/60 bg-[#BFA071]/5"
            : "border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5"
          }`}
      >
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onInputChange} />
        {uploading ? (
          <Loader2 className="w-8 h-8 animate-spin text-[#BFA071]/60" />
        ) : (
          <Upload className="w-8 h-8 text-[#BFA071]/40" />
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
            <p className="text-xs text-[#E0E6ED]/40 mt-0.5">Project: <span className="text-[#BFA071]/70">{saInfo.project_id}</span></p>
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
        <Loader2 className="w-8 h-8 animate-spin text-[#BFA071]/50" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#BFA071]/10 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#BFA071]/10 border border-[#BFA071]/20 rounded-2xl shrink-0">
            <Bot className="w-8 h-8 text-[#BFA071]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">AI Налаштування</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Service Account, моделі, промпт — все зберігається в БД</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost" size="sm" onClick={handleRefreshCache} disabled={refreshing}
            className="gap-2 border border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl"
            title="Примусово перезавантажити кеш бекенду"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Оновити кеш
          </Button>
          <Button
            variant="ghost" size="sm" onClick={handleReset}
            className="gap-2 border border-[#BFA071]/20 hover:border-[#BFA071]/40 hover:bg-[#BFA071]/5 text-[#BFA071]/60 hover:text-[#BFA071] rounded-xl"
          >
            <RotateCcw className="w-4 h-4" /> Скинути
          </Button>
          <Button
            size="sm" onClick={handleSave} disabled={saving}
            className="gap-2 h-9 rounded-xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px] shadow-lg shadow-[#BFA071]/10 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Зберегти
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-8">

        {/* Service Account */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">Google Vertex AI — Service Account</h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl p-5">
            <ServiceAccountUploader
              saInfo={saInfo}
              onUploaded={info => setSaInfo(info)}
            />
            <p className="text-[11px] text-[#E0E6ED]/30 mt-3">
              Завантажте JSON-файл сервісного акаунту Google Cloud. Зберігається в Supabase, бекенд бере звідси.
            </p>
          </div>
        </section>

        {/* Vertex location */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">Vertex AI Регіон</h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl p-5">
            <Field
              label="Location"
              hint="Регіон Vertex AI. Напр.: us-central1, europe-west1, europe-west4"
            >
              <TextInput
                value={settings.vertex_location}
                onChange={v => set("vertex_location", v)}
                placeholder="us-central1"
                mono
              />
            </Field>
          </div>
        </section>

        {/* Models */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">Моделі</h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl p-5 space-y-5">
            <Field
              label="AI Модель (генерація відповідей)"
              hint="Напр.: gemini-2.0-flash-lite, gemini-1.5-pro, gemini-2.0-flash"
            >
              <TextInput
                value={settings.ai_model}
                onChange={v => set("ai_model", v)}
                placeholder="gemini-2.0-flash-lite"
                mono
              />
            </Field>
            <Field
              label="Модель ембедингів"
              hint="УВАГА: Зміна потребує перерахунку всієї бази знань! Напр.: text-embedding-004"
            >
              <TextInput
                value={settings.embedding_model}
                onChange={v => set("embedding_model", v)}
                placeholder="text-embedding-004"
                mono
              />
            </Field>
          </div>
        </section>

        {/* Generation params */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">Параметри генерації</h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl p-5 space-y-6">
            <Field label="Temperature" hint="0.0 = детермінований, 1.0 = творчий. Для юридичних відповідей: 0.1">
              <SliderInput value={settings.temperature} onChange={v => set("temperature", v)} min={0} max={1} step={0.05} />
            </Field>
            <Field label="Top P" hint="Nucleus sampling. Рекомендовано: 0.8">
              <SliderInput value={settings.top_p} onChange={v => set("top_p", v)} min={0} max={1} step={0.05} />
            </Field>
          </div>
        </section>

        {/* System prompt */}
        <section>
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#BFA071]/70 mb-4">Системний промпт</h2>
          <div className="bg-[#0d1120]/60 border border-[#BFA071]/10 rounded-2xl p-5 space-y-4">
            <Field
              label="Системний промпт"
              hint="Базова інструкція для AI. Сюди НЕ входять: правила тарифу, профіль користувача, контекст пошуку — вони додаються автоматично."
            >
              <TextareaInput value={settings.system_prompt} onChange={v => set("system_prompt", v)} rows={12} />
            </Field>
            <div className="bg-[#0A0E1A]/60 border border-[#BFA071]/10 rounded-xl p-3 text-[11px] text-[#E0E6ED]/40 space-y-1">
              <p className="font-bold text-[#BFA071]/50 uppercase tracking-wider text-[10px]">Що додається автоматично до промпту:</p>
              <p>• <span className="text-[#E0E6ED]/60">Профіль користувача</span> — роль, спеціалізація, сфери (з онбордингу)</p>
              <p>• <span className="text-[#E0E6ED]/60">Правила відповіді</span> — по тарифу (детальність, кроки, сценарії)</p>
              <p>• <span className="text-[#E0E6ED]/60">Контекст</span> — знайдені документи з бази знань</p>
              <p>• <span className="text-[#E0E6ED]/60">Антигалюцинаційний блок</span> — заборона вигадувати поза контекстом</p>
            </div>
          </div>
        </section>

        {/* Info */}
        <div className="bg-[#0d1120]/40 border border-[#BFA071]/10 rounded-2xl p-4 text-xs text-[#E0E6ED]/40 space-y-1">
          <p>Кількість чанків на тариф керується в розділі <strong className="text-[#BFA071]/60">Тарифи → поля top_k</strong>.</p>
          <p>Service Account JSON зберігається окремо через кнопку завантаження — не через «Зберегти».</p>
          <p>Після збереження бекенд автоматично перезавантажує кеш. Кнопка «Оновити кеш» — примусове оновлення без збереження.</p>
        </div>

      </div>
    </div>
  )
}
