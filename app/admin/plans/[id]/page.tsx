"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowLeft, Save, Loader2, CheckCircle2, Plus, Trash2,
  GripVertical, Pencil, X, ToggleLeft, ToggleRight, CreditCard,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

// ── Types ──────────────────────────────────────────────────────────────────
type Plan = {
  id: string; name: string; price_uah: number; billing_period: string
  request_limit: number | null; badge_text: string | null; badge_color: string
  main_benefit: string | null; button_text: string; note_text: string | null
  extra_text: string | null; is_active: boolean; sort_order: number
  max_docs_retrieved: number; max_templates_retrieved: number
}
type Feature = { plan_id: string; feature_key: string; enabled: boolean }
type Benefit = { id: number; plan_id: string; category: string; text: string; sort_order: number }
type FeatureDef = { key: string; label: string; description: string | null; category: string; sort_order: number }

const CATEGORY_LABELS: Record<string, string> = {
  requests: "Запити", sources: "Джерела", response: "Відповідь",
}
const FEATURE_CATEGORY_LABELS: Record<string, string> = {
  sources: "Джерела", response: "Якість відповіді", access: "Доступ та можливості",
}

// ── Sortable benefit row ───────────────────────────────────────────────────
function SortableBenefit({
  benefit, onEdit, onDelete,
}: {
  benefit: Benefit
  onEdit: (b: Benefit) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: benefit.id })
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${isDragging ? "border-[#C9A84C]/40 bg-[#0d1120] shadow-xl" : "border-[#C9A84C]/10 bg-[#0A0E1A]/40 hover:border-[#C9A84C]/20"
        }`}
    >
      <button {...attributes} {...listeners} className="text-[#C9A84C]/20 hover:text-[#C9A84C]/50 cursor-grab active:cursor-grabbing shrink-0">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm text-[#E0E6ED]/80">{benefit.text}</span>
      <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#C9A84C]/5 text-[#C9A84C]/40 border border-[#C9A84C]/10 shrink-0">
        {CATEGORY_LABELS[benefit.category] ?? benefit.category}
      </span>
      <button onClick={() => onEdit(benefit)} className="opacity-0 group-hover:opacity-100 text-[#C9A84C]/40 hover:text-[#C9A84C] transition-all">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => onDelete(benefit.id)} className="opacity-0 group-hover:opacity-100 text-red-400/40 hover:text-red-400 transition-all">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function PlanEditPage() {
  const { id: planId } = useParams<{ id: string }>()
  const router = useRouter()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [benefits, setBenefits] = useState<Benefit[]>([])
  const [definitions, setDefinitions] = useState<FeatureDef[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"general" | "features" | "benefits">("general")

  // General tab state
  const [form, setForm] = useState<Partial<Plan>>({})
  const [savingGeneral, setSavingGeneral] = useState(false)

  // Features tab state
  const [featureMap, setFeatureMap] = useState<Record<string, boolean>>({})
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [editingDef, setEditingDef] = useState<FeatureDef | null>(null)
  const [defForm, setDefForm] = useState({ label: "", description: "" })
  const [savingDef, setSavingDef] = useState(false)

  // Benefits tab state
  const [newBenefitText, setNewBenefitText] = useState("")
  const [newBenefitCat, setNewBenefitCat] = useState("response")
  const [addingBenefit, setAddingBenefit] = useState(false)
  const [editingBenefit, setEditingBenefit] = useState<Benefit | null>(null)
  const [editBenefitForm, setEditBenefitForm] = useState({ text: "", category: "response" })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/plans")
      const data = await res.json()
      const p = (data.plans ?? []).find((x: Plan) => x.id === planId)
      if (!p) { toast.error("Тариф не знайдено"); return }
      setPlan(p); setForm(p)
      const planFeatures = (data.features ?? []).filter((f: Feature) => f.plan_id === planId)
      setFeatures(planFeatures)
      const fm: Record<string, boolean> = {}
      for (const f of planFeatures) fm[f.feature_key] = f.enabled
      setFeatureMap(fm)
      setBenefits((data.benefits ?? []).filter((b: Benefit) => b.plan_id === planId))
      setDefinitions(data.definitions ?? [])
    } catch { toast.error("Помилка завантаження") }
    finally { setLoading(false) }
  }, [planId])

  useEffect(() => { load() }, [load])

  // ── General save ──────────────────────────────────────────────────────
  const handleSaveGeneral = async () => {
    setSavingGeneral(true)
    try {
      const res = await fetch(`/api/admin/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast.success("Збережено")
      setPlan(f => ({ ...f!, ...form }))
    } catch { toast.error("Помилка збереження") }
    finally { setSavingGeneral(false) }
  }

  // ── Features save ─────────────────────────────────────────────────────
  const handleSaveFeatures = async () => {
    setSavingFeatures(true)
    try {
      const res = await fetch(`/api/admin/plans/${planId}/features`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: featureMap }),
      })
      if (!res.ok) throw new Error()
      toast.success("Фічі збережено")
    } catch { toast.error("Помилка збереження") }
    finally { setSavingFeatures(false) }
  }

  // ── Feature toggle with benefit auto-sync ────────────────────────────
  // Maps feature category → benefit category
  const FEAT_TO_BENEFIT_CAT: Record<string, string> = {
    sources: "sources", response: "response", access: "response",
  }

  const handleToggleFeature = async (def: FeatureDef, currentBenefits: Benefit[]) => {
    const newVal = !featureMap[def.key]

    // 1. Optimistic UI update
    setFeatureMap(m => ({ ...m, [def.key]: newVal }))

    // 2. Persist feature toggle immediately (upsert single row)
    try {
      const res = await fetch(`/api/admin/plans/${planId}/features`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { [def.key]: newVal } }),
      })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Помилка збереження фічі")
      setFeatureMap(m => ({ ...m, [def.key]: !newVal }))
      return
    }

    // 3. Sync benefit using passed-in current benefits (no stale closure)
    const benefitCat = FEAT_TO_BENEFIT_CAT[def.category] ?? "response"
    const existing = currentBenefits.find(b => b.text === def.label)

    if (newVal && !existing) {
      try {
        const res = await fetch(`/api/admin/plans/${planId}/benefits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: def.label, category: benefitCat }),
        })
        if (res.ok) {
          const newBenefit = await res.json()
          setBenefits(prev => [...prev, newBenefit])
          toast.success(`Benefit "${def.label}" додано у вкладці Benefits`)
        }
      } catch { toast.error("Не вдалося додати benefit") }
    } else if (!newVal && existing) {
      setBenefits(prev => prev.filter(b => b.id !== existing.id))
      fetch(`/api/admin/plans/benefits/${existing.id}`, { method: "DELETE" }).catch(() => { })
      toast.success(`Benefit "${def.label}" видалено`)
    }
  }

  // ── Feature definition edit ───────────────────────────────────────────
  const openDefEdit = (def: FeatureDef) => {
    setEditingDef(def)
    setDefForm({ label: def.label, description: def.description ?? "" })
  }
  const handleSaveDef = async () => {
    if (!editingDef) return
    setSavingDef(true)
    try {
      const res = await fetch("/api/admin/feature-definitions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: editingDef.key, ...defForm }),
      })
      if (!res.ok) throw new Error()
      setDefinitions(prev => prev.map(d => d.key === editingDef.key ? { ...d, ...defForm } : d))
      setEditingDef(null)
      toast.success("Опис оновлено")
    } catch { toast.error("Помилка збереження") }
    finally { setSavingDef(false) }
  }

  // ── Benefits ──────────────────────────────────────────────────────────
  const handleAddBenefit = async () => {
    if (!newBenefitText.trim()) return
    setAddingBenefit(true)
    try {
      const res = await fetch(`/api/admin/plans/${planId}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newBenefitText.trim(), category: newBenefitCat }),
      })
      const data = await res.json()
      setBenefits(prev => [...prev, data])
      setNewBenefitText("")
      toast.success("Додано")
    } catch { toast.error("Помилка") }
    finally { setAddingBenefit(false) }
  }

  const handleDeleteBenefit = async (id: number) => {
    setBenefits(prev => prev.filter(b => b.id !== id))
    await fetch(`/api/admin/plans/benefits/${id}`, { method: "DELETE" })
    toast.success("Видалено")
  }

  const handleSaveEditBenefit = async () => {
    if (!editingBenefit) return
    const res = await fetch(`/api/admin/plans/benefits/${editingBenefit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editBenefitForm),
    })
    const updated = await res.json()
    setBenefits(prev => prev.map(b => b.id === editingBenefit.id ? updated : b))
    setEditingBenefit(null)
    toast.success("Збережено")
  }

  const handleBenefitDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = benefits.findIndex(b => b.id === active.id)
    const newIdx = benefits.findIndex(b => b.id === over.id)
    const reordered = arrayMove(benefits, oldIdx, newIdx).map((b, i) => ({ ...b, sort_order: i }))
    setBenefits(reordered)
    await fetch("/api/admin/plans/benefits/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map(b => ({ id: b.id, sort_order: b.sort_order })) }),
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" />
      <span className="text-[10px] font-black text-[#C9A84C] uppercase tracking-widest">Завантаження...</span>
    </div>
  )

  if (!plan) return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <p className="text-[#E0E6ED]/50">Тариф не знайдено</p>
      <Button onClick={() => router.push("/admin/plans")} variant="ghost" className="text-[#C9A84C]">
        <ArrowLeft className="w-4 h-4 mr-2" /> Назад
      </Button>
    </div>
  )

  const grouped = definitions.reduce((acc, d) => {
    if (!acc[d.category]) acc[d.category] = []
    acc[d.category].push(d)
    return acc
  }, {} as Record<string, FeatureDef[]>)

  const benefitsByCategory = benefits.reduce((acc, b) => {
    if (!acc[b.category]) acc[b.category] = []
    acc[b.category].push(b)
    return acc
  }, {} as Record<string, Benefit[]>)

  return (
    <div className="space-y-6 py-2 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4 pb-6 border-b border-[#C9A84C]/10">
        <button onClick={() => router.push("/admin/plans")} className="p-2 rounded-xl text-[#C9A84C]/50 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-2xl shrink-0">
          <CreditCard className="w-6 h-6 text-[#C9A84C]" />
        </div>
        <div>
          <h1 className="text-2xl font-serif font-bold text-white">{plan.name}</h1>
          <p className="text-sm text-[#E0E6ED]/50 mt-0.5">
            {plan.price_uah === 0 ? "Безкоштовно" : `${plan.price_uah} грн / ${plan.billing_period === "day" ? "день" : "міс"}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0d1120] p-1.5 rounded-2xl border border-[#C9A84C]/10 w-fit">
        {(["general", "features", "benefits"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] transition-all ${activeTab === tab
                ? "bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/30"
                : "text-[#C9A84C]/50 hover:text-[#C9A84C]/70"
              }`}
          >
            {tab === "general" ? "Загальне" : tab === "features" ? "Фічі" : "Benefits"}
          </button>
        ))}
      </div>

      {/* ── TAB: GENERAL ─────────────────────────────────────────────── */}
      {activeTab === "general" && (
        <div className="space-y-5 bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-[2rem] p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Назва</Label>
              <Input value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Ціна (грн)</Label>
              <Input type="number" value={form.price_uah ?? 0} onChange={e => setForm(f => ({ ...f, price_uah: Number(e.target.value) }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Період</Label>
              <select value={form.billing_period ?? "month"} onChange={e => setForm(f => ({ ...f, billing_period: e.target.value }))}
                className="w-full h-11 px-3 rounded-xl border border-[#C9A84C]/20 bg-[#0A0E1A] text-[#E0E6ED] focus:outline-none focus:border-[#C9A84C]/50 text-sm">
                <option value="forever">Назавжди (free)</option>
                <option value="day">День</option>
                <option value="month">Місяць</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Ліміт запитів (порожньо = ∞)</Label>
              <Input type="number" value={form.request_limit ?? ""} placeholder="∞ (без обмежень)"
                onChange={e => setForm(f => ({ ...f, request_limit: e.target.value === "" ? null : Number(e.target.value) }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Чанків документів (top_k)</Label>
              <Input type="number" min={1} max={50} value={form.max_docs_retrieved ?? 5}
                onChange={e => setForm(f => ({ ...f, max_docs_retrieved: Number(e.target.value) }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
              <p className="text-[10px] text-[#E0E6ED]/30">Скільки документів підвантажується в контекст AI</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Чанків шаблонів (top_k)</Label>
              <Input type="number" min={0} max={10} value={form.max_templates_retrieved ?? 1}
                onChange={e => setForm(f => ({ ...f, max_templates_retrieved: Number(e.target.value) }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
              <p className="text-[10px] text-[#E0E6ED]/30">Скільки шаблонів документів пропонується</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Текст бейджа</Label>
              <Input value={form.badge_text ?? ""} placeholder="Найпопулярніший"
                onChange={e => setForm(f => ({ ...f, badge_text: e.target.value || null }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Колір бейджа</Label>
              <select value={form.badge_color ?? "gold"} onChange={e => setForm(f => ({ ...f, badge_color: e.target.value }))}
                className="w-full h-11 px-3 rounded-xl border border-[#C9A84C]/20 bg-[#0A0E1A] text-[#E0E6ED] focus:outline-none focus:border-[#C9A84C]/50 text-sm">
                <option value="gold">Золотий</option>
                <option value="emerald">Смарагдовий</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Головна вигода (→ текст)</Label>
              <Input value={form.main_benefit ?? ""} onChange={e => setForm(f => ({ ...f, main_benefit: e.target.value }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Текст кнопки</Label>
              <Input value={form.button_text ?? ""} onChange={e => setForm(f => ({ ...f, button_text: e.target.value }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Примітка під кнопкою</Label>
              <Input value={form.note_text ?? ""} placeholder="Без кредитної картки"
                onChange={e => setForm(f => ({ ...f, note_text: e.target.value || null }))}
                className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Маркетинговий текст (для Pro)</Label>
              <textarea value={form.extra_text ?? ""} rows={4}
                onChange={e => setForm(f => ({ ...f, extra_text: e.target.value || null }))}
                className="w-full px-4 py-3 rounded-xl border border-[#C9A84C]/20 bg-[#0A0E1A] text-[#E0E6ED] text-sm focus:outline-none focus:border-[#C9A84C]/50 resize-none" />
            </div>
          </div>

          {/* is_active toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-[#C9A84C]/10">
            <div>
              <p className="text-sm font-bold text-[#E0E6ED]">Активний тариф</p>
              <p className="text-xs text-[#E0E6ED]/40 mt-0.5">Відображається на сторінці тарифів</p>
            </div>
            <button onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))} className="text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors">
              {form.is_active ? <ToggleRight className="w-10 h-10 text-[#C9A84C]" /> : <ToggleLeft className="w-10 h-10" />}
            </button>
          </div>

          <Button onClick={handleSaveGeneral} disabled={savingGeneral}
            className="w-full h-12 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] transition-all active:scale-95">
            {savingGeneral ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Зберегти</>}
          </Button>
        </div>
      )}

      {/* ── TAB: FEATURES ────────────────────────────────────────────── */}
      {activeTab === "features" && (
        <div className="space-y-6">
          {/* Feature definition editor modal */}
          {editingDef && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingDef(null)} />
              <div className="relative w-full max-w-md bg-[#0d1120] border border-[#C9A84C]/30 rounded-[2rem] p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Редагування: <span className="text-[#C9A84C]">{editingDef.key}</span></p>
                  <button onClick={() => setEditingDef(null)} className="text-[#C9A84C]/40 hover:text-[#C9A84C]"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Label (підпис)</Label>
                  <Input value={defForm.label} onChange={e => setDefForm(f => ({ ...f, label: e.target.value }))}
                    className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Опис (для адмін-панелі)</Label>
                  <Input value={defForm.description} onChange={e => setDefForm(f => ({ ...f, description: e.target.value }))}
                    className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
                </div>
                <Button onClick={handleSaveDef} disabled={savingDef}
                  className="w-full h-11 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px]">
                  {savingDef ? <Loader2 className="w-4 h-4 animate-spin" /> : "Зберегти"}
                </Button>
              </div>
            </div>
          )}

          {Object.entries(grouped).map(([cat, defs]) => (
            <div key={cat} className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-[2rem] p-5 space-y-3">
              <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">
                {FEATURE_CATEGORY_LABELS[cat] ?? cat}
              </p>
              {defs.map(def => (
                <div key={def.key} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[#C9A84C]/10 bg-[#0A0E1A]/40 group">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggleFeature(def, benefits)}
                    className="shrink-0"
                  >
                    {featureMap[def.key]
                      ? <ToggleRight className="w-8 h-8 text-[#C9A84C]" />
                      : <ToggleLeft className="w-8 h-8 text-[#C9A84C]/20" />
                    }
                  </button>
                  {/* Label + description */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold transition-colors ${featureMap[def.key] ? "text-white" : "text-[#E0E6ED]/40"}`}>
                      {def.label}
                    </p>
                    {def.description && (
                      <p className="text-xs text-[#E0E6ED]/30 mt-0.5 truncate">{def.description}</p>
                    )}
                  </div>
                  {/* Key badge */}
                  <span className="shrink-0 text-[9px] font-mono text-[#C9A84C]/30 bg-[#C9A84C]/5 px-2 py-0.5 rounded-lg border border-[#C9A84C]/10">
                    {def.key}
                  </span>
                  {/* Edit definition button */}
                  <button onClick={() => openDefEdit(def)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[#C9A84C]/40 hover:text-[#C9A84C] transition-all">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}

          <Button onClick={handleSaveFeatures} disabled={savingFeatures}
            className="w-full h-12 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] transition-all active:scale-95">
            {savingFeatures ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Зберегти фічі</>}
          </Button>
        </div>
      )}

      {/* ── TAB: BENEFITS ────────────────────────────────────────────── */}
      {activeTab === "benefits" && (
        <div className="space-y-6">
          {/* Edit benefit modal */}
          {editingBenefit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingBenefit(null)} />
              <div className="relative w-full max-w-md bg-[#0d1120] border border-[#C9A84C]/30 rounded-[2rem] p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Редагування benefit</p>
                  <button onClick={() => setEditingBenefit(null)} className="text-[#C9A84C]/40 hover:text-[#C9A84C]"><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Текст</Label>
                  <Input value={editBenefitForm.text} onChange={e => setEditBenefitForm(f => ({ ...f, text: e.target.value }))}
                    className="bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Категорія</Label>
                  <select value={editBenefitForm.category} onChange={e => setEditBenefitForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full h-11 px-3 rounded-xl border border-[#C9A84C]/20 bg-[#0A0E1A] text-[#E0E6ED] focus:outline-none focus:border-[#C9A84C]/50 text-sm">
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <Button onClick={handleSaveEditBenefit}
                  className="w-full h-11 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px]">
                  Зберегти
                </Button>
              </div>
            </div>
          )}

          {/* Add new benefit */}
          {/* <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-[2rem] p-5 space-y-3">
            <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Додати benefit</p>
            <div className="flex gap-3">
              <Input value={newBenefitText} onChange={e => setNewBenefitText(e.target.value)}
                placeholder="Текст пункту..."
                onKeyDown={e => e.key === "Enter" && handleAddBenefit()}
                className="flex-1 bg-[#0A0E1A] border-[#C9A84C]/20 rounded-xl text-[#E0E6ED] placeholder:text-[#C9A84C]/20 focus:border-[#C9A84C]/50 focus:ring-0 h-11" />
              <select value={newBenefitCat} onChange={e => setNewBenefitCat(e.target.value)}
                className="h-11 px-3 rounded-xl border border-[#C9A84C]/20 bg-[#0A0E1A] text-[#E0E6ED] focus:outline-none focus:border-[#C9A84C]/50 text-sm shrink-0">
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button onClick={handleAddBenefit} disabled={addingBenefit || !newBenefitText.trim()}
                className="h-11 px-4 rounded-xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black shrink-0">
                {addingBenefit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </div>
          </div> */}

          {/* Benefits list grouped by category */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBenefitDragEnd}>
            <SortableContext items={benefits.map(b => b.id)} strategy={verticalListSortingStrategy}>
              {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
                const catBenefits = (benefitsByCategory[cat] ?? [])
                if (catBenefits.length === 0) return null
                return (
                  <div key={cat} className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-[2rem] p-5 space-y-2">
                    <p className="text-[10px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em] mb-3">{catLabel}</p>
                    {catBenefits.map(b => (
                      <SortableBenefit
                        key={b.id}
                        benefit={b}
                        onEdit={ben => { setEditingBenefit(ben); setEditBenefitForm({ text: ben.text, category: ben.category }) }}
                        onDelete={handleDeleteBenefit}
                      />
                    ))}
                  </div>
                )
              })}
            </SortableContext>
          </DndContext>

          {benefits.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-[#C9A84C]/10" />
              <p className="text-sm text-[#E0E6ED]/40">Немає benefits. Додайте перший пункт вище.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
