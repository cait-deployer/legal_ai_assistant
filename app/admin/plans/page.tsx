"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
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
  CreditCard, GripVertical, Pencil, RefreshCw, Loader2,
  CheckCircle2, XCircle, Infinity, Zap, Star,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

type Plan = {
  id: string
  name: string
  price_uah: number
  billing_period: string
  request_limit: number | null
  badge_text: string | null
  badge_color: string
  main_benefit: string | null
  is_active: boolean
  sort_order: number
}

function PeriodLabel({ period }: { period: string }) {
  if (period === "forever") return <span className="text-[#E0E6ED]/40">назавжди</span>
  if (period === "day") return <span className="text-[#E0E6ED]/40">/ день</span>
  return <span className="text-[#E0E6ED]/40">/ міс</span>
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap ${color === "emerald"
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/20"
      }`}>
      {text}
    </span>
  )
}

function SortablePlanRow({ plan, featureCount }: { plan: Plan; featureCount: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plan.id })
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined }

  const priceLabel = plan.price_uah === 0 ? "Безкоштовно" : `${plan.price_uah} грн`
  const periodLabel = plan.billing_period === "forever" ? "" : plan.billing_period === "day" ? "/ день" : "/ міс"

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl border transition-all ${isDragging
          ? "border-[#C9A84C]/40 bg-[#0d1120] shadow-2xl shadow-black/40"
          : "border-[#C9A84C]/10 bg-[#0d1120]/60 hover:border-[#C9A84C]/25"
        }`}
    >
      {/* ── MOBILE layout ── */}
      <div className="flex sm:hidden items-center gap-3 px-3 py-3">
        {/* Drag handle */}
        <button {...attributes} {...listeners}
          className="text-[#C9A84C]/20 hover:text-[#C9A84C]/50 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Number */}
        <div className="w-6 h-6 rounded-md bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <span className="text-[12px] font-black text-[#C9A84C]/60">{plan.sort_order + 1}</span>
        </div>

        {/* Name + details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-serif font-bold text-white text-sm">{plan.name}</span>
            {plan.badge_text && <Badge text={plan.badge_text} color={plan.badge_color} />}
          </div>
          <p className="text-[12px] text-[#E0E6ED]/40 mt-0.5">
            {plan.request_limit == null ? "∞ запитів" : `${plan.request_limit} запитів`}
            {" · "}{featureCount} фіч
          </p>
        </div>

        {/* Price + active + edit */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <p className="text-sm font-bold text-[#C9A84C] leading-tight">{priceLabel}</p>
            {periodLabel && <p className="text-[12px] text-[#E0E6ED]/40">{periodLabel}</p>}
          </div>
          {plan.is_active
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            : <XCircle className="w-4 h-4 text-[#C9A84C]/20 shrink-0" />
          }
          <Link href={`/admin/plans/${plan.id}`} className="shrink-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[#C9A84C]/40 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 rounded-lg">
              <Pencil className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </div>

      {/* ── DESKTOP layout ── */}
      <div className="hidden sm:flex items-center gap-4 px-5 py-4">
        <button {...attributes} {...listeners}
          className="text-[#C9A84C]/20 hover:text-[#C9A84C]/50 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="w-5 h-5" />
        </button>

        <div className="w-7 h-7 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center shrink-0">
          <span className="text-[12px] font-black text-[#C9A84C]/60">{plan.sort_order + 1}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-serif font-bold text-white text-base">{plan.name}</span>
            {plan.badge_text && <Badge text={plan.badge_text} color={plan.badge_color} />}
          </div>
          {plan.main_benefit && (
            <p className="text-xs text-[#E0E6ED]/40 mt-0.5 truncate">→ {plan.main_benefit}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="font-bold text-[#C9A84C] text-lg">{priceLabel}</div>
          {plan.price_uah > 0 && <PeriodLabel period={plan.billing_period} />}
        </div>

        <div className="shrink-0 w-32 text-center">
          {plan.request_limit == null
            ? <Infinity className="w-4 h-4 text-[#C9A84C]/60 mx-auto" />
            : <span className="text-sm text-[#E0E6ED]/60">{plan.request_limit} запитів</span>
          }
        </div>

        <div className="shrink-0 w-20 text-center">
          <span className="text-xs text-[#C9A84C]/50">{featureCount} фіч</span>
        </div>

        <div className="shrink-0">
          {plan.is_active
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <XCircle className="w-4 h-4 text-[#C9A84C]/20" />
          }
        </div>

        <Link href={`/admin/plans/${plan.id}`} className="shrink-0">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-[#C9A84C]/40 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 rounded-xl">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  )
}

export default function PlansListPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [featureCounts, setFeatureCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/plans")
      const data = await res.json()
      setPlans(data.plans ?? [])
      // count enabled features per plan
      const counts: Record<string, number> = {}
      for (const f of data.features ?? []) {
        if (f.enabled) counts[f.plan_id] = (counts[f.plan_id] ?? 0) + 1
      }
      setFeatureCounts(counts)
    } catch { toast.error("Помилка завантаження") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = plans.findIndex(p => p.id === active.id)
    const newIndex = plans.findIndex(p => p.id === over.id)
    const reordered = arrayMove(plans, oldIndex, newIndex).map((p, i) => ({ ...p, sort_order: i }))
    setPlans(reordered)

    setSaving(true)
    try {
      await fetch("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: reordered.map(p => ({ id: p.id, sort_order: p.sort_order })) }),
      })
      toast.success("Порядок збережено")
    } catch { toast.error("Помилка збереження порядку") }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-6 py-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#C9A84C]/10">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl sm:rounded-2xl shrink-0">
            <CreditCard className="w-5 h-5 sm:w-8 sm:h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-serif font-bold text-white">Тарифи</h1>
            <p className="text-xs sm:text-sm text-[#E0E6ED]/70 hidden sm:block mt-1">Drag-and-drop для зміни порядку. Клік на олівець для редагування.</p>
          </div>
        </div>
        <Button
          variant="ghost" size="sm" onClick={load} disabled={loading}
          className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl h-9"
        >
          {loading || saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="hidden sm:inline">Оновити</span>
        </Button>
      </div>

      {/* Column headers — desktop only */}
      <div className="hidden sm:flex items-center gap-4 px-5 text-[9px] font-black text-[#C9A84C]/30 uppercase tracking-[0.2em]">
        <div className="w-5 shrink-0" />
        <div className="w-7 shrink-0" />
        <div className="flex-1">Назва</div>
        <div className="w-32 text-right">Ціна</div>
        <div className="w-32 text-center">Запити</div>
        <div className="w-20 text-center">Фічі</div>
        <div className="w-6 text-center">Акт.</div>
        <div className="w-8" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-2xl bg-[#C9A84C]/5 animate-pulse" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={plans.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {plans.map(plan => (
                <SortablePlanRow key={plan.id} plan={plan} featureCount={featureCounts[plan.id] ?? 0} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <p className="text-center text-[12px] text-[#C9A84C]/30 font-black uppercase tracking-widest pt-4">
        {plans.length} тарифів
      </p>
    </div>
  )
}
