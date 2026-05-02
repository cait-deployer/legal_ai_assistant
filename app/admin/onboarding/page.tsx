"use client"

import { useState, useEffect } from "react"
import {
  ClipboardList, Loader2, Plus, Trash2, Pencil, X, Save,
  ToggleLeft, ToggleRight, BarChart3, Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

type Step = {
  id: string; step_key: string; title: string; subtitle: string | null
  order_index: number; is_active: boolean
}
type Option = {
  id: string; step_key: string; value: string; label: string
  description: string | null; icon: string | null
  parent_value: string | null; order_index: number; is_active: boolean
}
type Response = { segments: string[]; role: string | null; sub_role: string | null; completed_at: string }

const STEP_TABS: { key: string; label: string }[] = [
  { key: "segments", label: "Сфери" },
  { key: "roles", label: "Ролі" },
  { key: "sub_roles", label: "Спеціалізації" },
]

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5 flex flex-col gap-1">
      <p className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/60">{label}</p>
      <p className="text-2xl font-serif font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-[#E0E6ED]/40">{sub}</p>}
    </div>
  )
}

export default function OnboardingAdminPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [options, setOptions] = useState<Option[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"config" | "stats">("config")
  const [activeStep, setActiveStep] = useState("segments")

  // Add/edit option modal
  const [modal, setModal] = useState<null | "add" | Option>(null)
  const [form, setForm] = useState({ label: "", description: "", icon: "", parent_value: "", value: "" })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/admin/onboarding")
      const d = await r.json()
      setSteps(d.steps ?? [])
      setOptions(d.options ?? [])
      setResponses(d.responses ?? [])
    } catch { toast.error("Помилка завантаження") }
    finally { setLoading(false) }
  }

  const openAdd = () => {
    setForm({ label: "", description: "", icon: "", parent_value: "", value: "" })
    setModal("add")
  }
  const openEdit = (opt: Option) => {
    setForm({
      label: opt.label,
      description: opt.description ?? "",
      icon: opt.icon ?? "",
      parent_value: opt.parent_value ?? "",
      value: opt.value,
    })
    setModal(opt)
  }

  const handleSave = async () => {
    if (!form.label.trim() || !form.value.trim()) {
      toast.error("Заповніть поля Value та Label")
      return
    }
    setSaving(true)
    try {
      if (modal === "add") {
        const res = await fetch("/api/admin/onboarding/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            step_key: activeStep,
            value: form.value.trim(),
            label: form.label.trim(),
            description: form.description || null,
            icon: form.icon || null,
            parent_value: form.parent_value || null,
          }),
        })
        if (!res.ok) throw new Error()
        toast.success("Варіант додано")
      } else if (modal && typeof modal === "object") {
        const res = await fetch("/api/admin/onboarding/options", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: modal.id,
            label: form.label.trim(),
            description: form.description || null,
            icon: form.icon || null,
            parent_value: form.parent_value || null,
          }),
        })
        if (!res.ok) throw new Error()
        toast.success("Збережено")
      }
      setModal(null)
      await load()
    } catch { toast.error("Помилка збереження") }
    finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Видалити цей варіант?")) return
    try {
      const res = await fetch(`/api/admin/onboarding/options?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Видалено")
      await load()
    } catch { toast.error("Помилка видалення") }
  }

  const handleToggle = async (opt: Option) => {
    try {
      await fetch("/api/admin/onboarding/options", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: opt.id, is_active: !opt.is_active }),
      })
      setOptions(prev => prev.map(o => o.id === opt.id ? { ...o, is_active: !o.is_active } : o))
    } catch { toast.error("Помилка") }
  }

  // Stats
  const totalResponses = responses.length
  const completedCount = responses.filter(r => r.role).length
  const segmentCounts: Record<string, number> = {}
  const roleCounts: Record<string, number> = {}
  for (const r of responses) {
    for (const s of r.segments ?? []) segmentCounts[s] = (segmentCounts[s] ?? 0) + 1
    if (r.role) roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1
  }
  const topSegment = Object.entries(segmentCounts).sort((a, b) => b[1] - a[1])[0]
  const topRole = Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]

  const currentOptions = options.filter(o => o.step_key === activeStep)

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
      <div className="flex items-center gap-3 pb-4 border-b border-[#C9A84C]/10 shrink-0">
        <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
          <ClipboardList className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
        </div>
        <div>
          <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Онбординг</h1>
          <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">Вступний опитувальник — кроки та варіанти відповідей</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0d1120] p-1.5 rounded-2xl border border-[#C9A84C]/10 w-fit mt-6 mb-6 shrink-0">
        {([["config", "Налаштування"], ["stats", "Статистика"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] transition-all ${activeTab === key
                ? "bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/30"
                : "text-[#C9A84C]/50 hover:text-[#C9A84C]/70"
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-6">

        {/* ── TAB: CONFIG ── */}
        {activeTab === "config" && (
          <>
            {/* Step selector */}
            <div className="flex gap-2">
              {STEP_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveStep(tab.key)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${activeStep === tab.key
                      ? "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/30"
                      : "text-[#E0E6ED]/50 border-[#C9A84C]/10 hover:border-[#C9A84C]/20 hover:text-[#E0E6ED]/70"
                    }`}
                >
                  {tab.label} ({options.filter(o => o.step_key === tab.key).length})
                </button>
              ))}
            </div>

            {/* Step title */}
            {steps.find(s => s.step_key === activeStep) && (
              <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-4">
                <p className="text-sm font-bold text-white">
                  {steps.find(s => s.step_key === activeStep)?.title}
                </p>
                <p className="text-xs text-[#E0E6ED]/40 mt-0.5">
                  {steps.find(s => s.step_key === activeStep)?.subtitle}
                </p>
              </div>
            )}

            {/* Options list */}
            <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#C9A84C]/10">
                <p className="text-xs font-bold text-[#E0E6ED]/70">
                  Варіанти відповідей ({currentOptions.length})
                </p>
                <Button
                  size="sm"
                  onClick={openAdd}
                  className="gap-1.5 h-8 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-wider text-[10px]"
                >
                  <Plus className="w-3.5 h-3.5" /> Додати
                </Button>
              </div>

              {currentOptions.length === 0 ? (
                <p className="text-sm text-[#E0E6ED]/30 py-10 text-center">Варіантів немає</p>
              ) : (
                <div className="divide-y divide-[#C9A84C]/5">
                  {currentOptions.map(opt => (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-3 px-5 py-3.5 group transition-colors ${!opt.is_active ? "opacity-40" : "hover:bg-[#C9A84C]/3"}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#E0E6ED]">{opt.label}</span>
                          <span className="text-[12px] font-mono text-[#C9A84C]/40 bg-[#C9A84C]/5 px-1.5 py-0.5 rounded-md">{opt.value}</span>
                          {opt.icon && (
                            <span className="text-[12px] text-[#E0E6ED]/30">{opt.icon}</span>
                          )}
                        </div>
                        {opt.description && (
                          <p className="text-xs text-[#E0E6ED]/40 mt-0.5 truncate">{opt.description}</p>
                        )}
                        {opt.parent_value && (
                          <p className="text-[12px] text-[#C9A84C]/50 mt-0.5">→ {opt.parent_value}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleToggle(opt)}
                          className="text-[#C9A84C]/40 hover:text-[#C9A84C] transition-colors p-1"
                          title={opt.is_active ? "Деактивувати" : "Активувати"}
                        >
                          {opt.is_active
                            ? <ToggleRight className="w-5 h-5 text-[#C9A84C]" />
                            : <ToggleLeft className="w-5 h-5" />
                          }
                        </button>
                        <button onClick={() => openEdit(opt)} className="text-[#C9A84C]/40 hover:text-[#C9A84C] transition-colors p-1">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(opt.id)} className="text-red-400/40 hover:text-red-400 transition-colors p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── TAB: STATS ── */}
        {activeTab === "stats" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Всього відповідей" value={totalResponses} />
              <StatCard label="Завершили повністю" value={completedCount} />
              <StatCard label="Топ сегмент" value={topSegment?.[0] ?? "—"} sub={topSegment ? `${topSegment[1]} чол.` : undefined} />
              <StatCard label="Топ роль" value={topRole?.[0] ?? "—"} sub={topRole ? `${topRole[1]} чол.` : undefined} />
            </div>

            {/* Segment breakdown */}
            <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-5">
              <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/70 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Розподіл по сегментах
              </h3>
              <div className="space-y-2.5">
                {Object.entries(segmentCounts).sort((a, b) => b[1] - a[1]).map(([seg, count]) => {
                  const opt = options.find(o => o.value === seg)
                  const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
                  return (
                    <div key={seg} className="flex items-center gap-3">
                      <span className="text-xs text-[#E0E6ED]/70 w-40 truncate shrink-0">{opt?.label ?? seg}</span>
                      <div className="flex-1 h-2 bg-[#C9A84C]/5 rounded-full overflow-hidden">
                        <div className="h-full bg-[#C9A84C]/40 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[#C9A84C] w-8 text-right shrink-0">{count}</span>
                    </div>
                  )
                })}
                {Object.keys(segmentCounts).length === 0 && (
                  <p className="text-sm text-[#E0E6ED]/30 text-center py-4">Даних ще немає</p>
                )}
              </div>
            </div>

            {/* Recent responses */}
            <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-[#C9A84C]/10">
                <Users className="w-4 h-4 text-[#C9A84C]/60" />
                <p className="text-xs font-bold text-[#E0E6ED]/70">Останні відповіді</p>
              </div>
              {responses.length === 0 ? (
                <p className="text-sm text-[#E0E6ED]/30 py-10 text-center">Відповідей ще немає</p>
              ) : (
                <div className="divide-y divide-[#C9A84C]/5">
                  {responses.slice(0, 50).map((r, i) => (
                    <div key={i} className="flex items-start gap-4 px-5 py-3 text-xs">
                      <span className="text-[#E0E6ED]/30 shrink-0 tabular-nums w-28">
                        {new Date(r.completed_at).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <div className="flex flex-wrap gap-1 flex-1">
                        {(r.segments ?? []).map(s => {
                          const opt = options.find(o => o.value === s)
                          return (
                            <span key={s} className="px-2 py-0.5 rounded-lg bg-[#C9A84C]/8 text-[#C9A84C]/70 border border-[#C9A84C]/10 text-[12px] font-bold">
                              {opt?.label ?? s}
                            </span>
                          )
                        })}
                        {r.role && (
                          <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/10 text-[12px] font-bold">
                            {r.role}
                          </span>
                        )}
                        {r.sub_role && (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/10 text-[12px] font-bold">
                            {r.sub_role}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modal ── */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="relative w-full max-w-md bg-[#0d1120] border border-[#C9A84C]/30 rounded-[2rem] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">
                {modal === "add" ? "Новий варіант" : "Редагувати варіант"}
              </p>
              <button onClick={() => setModal(null)} className="text-[#C9A84C]/40 hover:text-[#C9A84C]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {modal === "add" && (
                <div className="space-y-1">
                  <label className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-wider">Value (key)</label>
                  <input
                    value={form.value}
                    onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                    placeholder="legal_pro"
                    className="w-full bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] outline-none focus:border-[#C9A84C]/50 font-mono"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-wider">Label (назва)</label>
                <input
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Юридична сфера"
                  className="w-full bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] outline-none focus:border-[#C9A84C]/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-wider">Опис</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Адвокати, юристи, нотаріуси"
                  className="w-full bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] outline-none focus:border-[#C9A84C]/50"
                />
              </div>
              {activeStep === "segments" && (
                <div className="space-y-1">
                  <label className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-wider">Іконка Lucide</label>
                  <input
                    value={form.icon}
                    onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                    placeholder="Scale"
                    className="w-full bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] outline-none focus:border-[#C9A84C]/50 font-mono"
                  />
                </div>
              )}
              {activeStep === "sub_roles" && (
                <div className="space-y-1">
                  <label className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-wider">
                    Прив'язка до сегмента (parent_value)
                  </label>
                  <select
                    value={form.parent_value}
                    onChange={e => setForm(f => ({ ...f, parent_value: e.target.value }))}
                    className="w-full bg-[#0A0E1A] border border-[#C9A84C]/20 rounded-xl px-4 py-2.5 text-sm text-[#E0E6ED] outline-none focus:border-[#C9A84C]/50"
                  >
                    <option value="">— всі сегменти —</option>
                    {options.filter(o => o.step_key === "segments").map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-11 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px]"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Зберегти</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
