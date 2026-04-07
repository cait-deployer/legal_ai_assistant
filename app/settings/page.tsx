// 
"use client"

import { useState, useTransition, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import useSWR, { mutate } from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  User, Shield, CreditCard, BarChart2,
  Loader2, CheckCircle2, AlertCircle, LogOut,
  MapPin, Monitor, Clock, Trash2, Eye, EyeOff,
  ChevronRight, Zap, Star, Infinity, Scale, History
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { ChatSidebar } from "@/components/chat-sidebar"
import { motion, AnimatePresence } from "framer-motion"

// ── Types
type Segment = "legal_pro" | "business_finance" | "gov_sector" | "military_theme" | "social_vulnerable" | "daily_life" | "specialized_niche"
type Profile = {
  id: string; email: string; full_name: string | null; segment: Segment[]; role: string | null;
  sub_role: string[]; subscription_tier: "free" | "basic" | "pro" | "ultra"; auth_provider: string;
  requests_this_month: number; monthly_limit: number | null; limit_reset_at: string | null;
  total_requests: number; last_ip: string | null; last_city: string | null; last_country: string | null;
  user_agent: string | null; created_at: string; updated_at: string;
  marketing_consent: boolean; trial_used: boolean;
  last_active_at: string | null; avg_session_duration: number; session_count: number;
}

const SEGMENT_LABELS: Record<Segment, string> = {
  legal_pro: "Юридична сфера", business_finance: "Бізнес і фінанси", gov_sector: "Держсектор",
  military_theme: "Військова тематика", social_vulnerable: "Соціально вразливі",
  daily_life: "Повсякденні питання", specialized_niche: "Спеціалізована ніша",
}
const ALL_SEGMENTS = Object.keys(SEGMENT_LABELS) as Segment[]
const ROLES = [
  { value: "lawyer", label: "Юрист / Адвокат" }, { value: "accountant", label: "Бухгалтер" },
  { value: "tax_specialist", label: "Податковий консультант" }, { value: "business_owner", label: "Підприємець" },
  { value: "private_person", label: "Приватна особа" },
]

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error("fetch error"); return r.json() })

function AuthBg() {
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
      <div className="absolute top-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-[#BFA071]/5 blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/3 blur-[120px]" />
    </div>
  );
}

// ── Tab: Profile
function ProfileTab({ profile }: { profile: Profile }) {
  const [fullName, setFullName] = useState(profile.full_name ?? "")
  const [role, setRole] = useState(profile.role ?? "")
  const [segments, setSegments] = useState<Segment[]>(profile.segment ?? [])
  const [marketingConsent, setMarketingConsent] = useState(profile.marketing_consent ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [, startTransition] = useTransition()

  const toggleSegment = (s: Segment) => setSegments(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const handleSave = async () => {
    setSaving(true); setError(""); setSaved(false)
    const res = await fetch("/api/settings/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, role, segment: segments, marketing_consent: marketingConsent }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true); startTransition(() => { mutate("/api/settings/profile") })
      setTimeout(() => setSaved(false), 3000)
    } else { setError("Помилка збереження. Спробуйте ще раз.") }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-xl pb-10">
      <div className="flex items-center gap-6 p-6 rounded-[2rem] bg-[#0d1120]/60 border border-[#BFA071]/10 backdrop-blur-md">
        <div className="w-20 h-20 rounded-2xl bg-[#BFA071] flex items-center justify-center text-3xl font-serif font-bold text-[#0A0E1A] shadow-lg shadow-[#BFA071]/20">
          {(fullName || profile.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-xl font-serif font-bold text-[#E0E6ED]">{fullName || "Користувач"}</h2>
          <p className="text-sm text-[#BFA071]/60 font-medium">{profile.email}</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Повне ім&apos;я</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Іваненко Іван Іванович" className="bg-[#0d1120] border-[#BFA071]/20 rounded-2xl h-12 text-[#E0E6ED] focus:border-[#BFA071]/50 focus:ring-0" />
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Ваша роль</Label>
          <div className="grid grid-cols-1 gap-2">
            {ROLES.map(r => (
              <button key={r.value} onClick={() => setRole(r.value)} className={`px-5 py-3 rounded-xl border text-left text-sm font-bold transition-all ${role === r.value ? "border-[#BFA071] bg-[#BFA071]/10 text-[#BFA071]" : "border-[#BFA071]/10 bg-[#0d1120]/40 text-[#E0E6ED]/60 hover:border-[#BFA071]/30"}`}>
                <div className="flex items-center justify-between">
                  {r.label}
                  {role === r.value && <CheckCircle2 className="w-4 h-4" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Сфери інтересів</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_SEGMENTS.map(s => (
              <button key={s} onClick={() => toggleSegment(s)} className={`px-4 py-2 rounded-full border text-[10px] font-black transition-all uppercase tracking-wider ${segments.includes(s) ? "border-[#BFA071] bg-[#BFA071] text-[#0A0E1A]" : "border-[#BFA071]/20 text-[#BFA071]/60 hover:border-[#BFA071]/40"}`}>
                {SEGMENT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Marketing consent */}
        <button
          type="button"
          onClick={() => setMarketingConsent(v => !v)}
          className={`w-full flex items-start gap-4 px-5 py-4 rounded-2xl border transition-all text-left ${marketingConsent ? "border-[#BFA071]/30 bg-[#BFA071]/5" : "border-[#BFA071]/10 bg-transparent hover:border-[#BFA071]/20"}`}
        >
          <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${marketingConsent ? "border-[#BFA071] bg-[#BFA071]" : "border-[#BFA071]/30"}`}>
            {marketingConsent && <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0E1A]" strokeWidth={2.5} />}
          </div>
          <div>
            <p className={`text-sm font-bold transition-colors ${marketingConsent ? "text-[#E0E6ED]" : "text-[#E0E6ED]/60"}`}>
              Отримувати новини та оновлення
            </p>
            <p className="text-xs text-[#E0E6ED]/40 mt-0.5 leading-relaxed">
              Надсилати на email корисні оновлення, поради та новини URAI. Можна скасувати в будь-який час.
            </p>
          </div>
        </button>
      </div>

      {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 p-4 rounded-2xl flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}

      <Button onClick={handleSave} disabled={saving} className="h-14 w-full rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-widest shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <CheckCircle2 className="w-5 h-5" /> : "ЗБЕРЕГТИ ЗМІНИ"}
      </Button>
    </motion.div>
  )
}

// ── Tab: Security (Повна логіка відновлена)
function SecurityTab({ profile }: { profile: Profile }) {
  const router = useRouter(); const supabase = createClient()
  const [currentPwd, setCurrentPwd] = useState(""); const [newPwd, setNewPwd] = useState("")
  const [showCurrent, setShowCurrent] = useState(false); const [showNew, setShowNew] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false); const [pwdMsg, setPwdMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(""); const [deleting, setDeleting] = useState(false); const [showDeleteZone, setShowDeleteZone] = useState(false)

  const handleChangePassword = async () => {
    setPwdSaving(true); setPwdMsg(null)
    const res = await fetch("/api/settings/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }) })
    setPwdSaving(false)
    if (res.ok) { setPwdMsg({ type: "ok", text: "Пароль успішно змінено!" }); setCurrentPwd(""); setNewPwd("") }
    else {
      const data = await res.json()
      const msgs: Record<string, string> = {
        wrong_current_password: "Поточний пароль невірний",
        password_too_short: "Новий пароль — мінімум 6 символів",
        google_account: "Ваш акаунт прив'язаний до Google — зміна пароля недоступна",
      }
      setPwdMsg({ type: "err", text: msgs[data.error] ?? "Помилка. Спробуйте ще раз." })
    }
  }

  const handleLogout = async () => { await supabase.auth.signOut(); document.cookie = "_ob=; path=/; max-age=0"; router.push("/auth/login") }

  const handleDelete = async () => {
    if (deleteConfirm !== "DELETE") return
    setDeleting(true)
    const res = await fetch("/api/settings/delete-account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    })
    if (res.ok) router.push("/auth/login")
    else setDeleting(false)
  }

  const formatUA = (ua: string | null) => {
    if (!ua) return "Невідомий пристрій"
    if (ua.includes("Chrome")) return "Chrome"
    if (ua.includes("Firefox")) return "Firefox"
    if (ua.includes("Safari")) return "Safari"
    return "Браузер"
  }

  const formatOS = (ua: string | null) => {
    if (!ua) return ""
    if (ua.includes("Windows")) return "Windows"
    if (ua.includes("Mac")) return "macOS"
    if (ua.includes("Linux")) return "Linux"
    if (ua.includes("Android")) return "Android"
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS"
    return ""
  }

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10 max-w-xl pb-10">
      <section className="space-y-4">
        <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Остання активність</Label>
        <div className="p-6 rounded-3xl bg-[#0d1120]/60 border border-[#BFA071]/10 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#BFA071]/10 border border-[#BFA071]/20 flex items-center justify-center text-[#BFA071]"><Monitor className="w-5 h-5" /></div>
            <div>
              <p className="text-sm font-bold text-[#E0E6ED]">{formatUA(profile.user_agent)} · {formatOS(profile.user_agent)}</p>
              <p className="text-[10px] text-[#BFA071]/60 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />
                {profile.last_city && profile.last_country ? `${profile.last_city}, ${profile.last_country}` : profile.last_ip ?? "Місце невідоме"}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full tracking-widest">ПОТОЧНА</span>
        </div>
      </section>

      <section className="space-y-6">
        <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Зміна пароля</Label>
        {profile.auth_provider !== 'email' ? (
          <div className="p-5 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-4">
            <Shield className="w-5 h-5 text-[#BFA071]/70 mt-0.5" />
            <div className="text-xs text-white/60 leading-relaxed">
              Ваш акаунт пов&apos;язаний з {profile.auth_provider === "google" ? "Google" : profile.auth_provider}.
              Керуйте безпекою в налаштуваннях провайдера.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} placeholder="Поточний пароль" className="bg-[#0d1120] border-[#BFA071]/20 rounded-2xl h-12 text-[#E0E6ED] pr-12 focus:border-[#BFA071]/50" />
              <button onClick={() => setShowCurrent(!showCurrent)} className="absolute right-4 top-3.5 text-[#BFA071]/70 hover:text-[#BFA071]">{showCurrent ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Новий пароль (мін. 6 символів)" className="bg-[#0d1120] border-[#BFA071]/20 rounded-2xl h-12 text-[#E0E6ED] pr-12 focus:border-[#BFA071]/50" />
              <button onClick={() => setShowNew(!showNew)} className="absolute right-4 top-3.5 text-[#BFA071]/70 hover:text-[#BFA071]">{showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
            {pwdMsg && <div className={`text-xs p-3 rounded-xl border flex items-center gap-2 ${pwdMsg.type === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>{pwdMsg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {pwdMsg.text}</div>}
            <Button onClick={handleChangePassword} disabled={pwdSaving || !currentPwd || !newPwd} className="w-full h-12 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-[11px] tracking-widest uppercase transition-all">ОНОВИТИ ПАРОЛЬ</Button>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <Label className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] ml-1">Сесія</Label>
        <Button onClick={handleLogout} variant="outline" className="h-12 gap-2 w-full rounded-2xl border-[#BFA071]/10 text-white hover:bg-[#BFA071]/10 uppercase font-black text-[10px] tracking-widest">
          <LogOut className="w-4 h-4" /> Вийти з акаунта
        </Button>
      </section>

      <section className="p-8 rounded-[2rem] border border-red-500/20 bg-red-500/5 space-y-5">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <h3 className="font-serif font-bold">Небезпечна зона</h3>
        </div>
        <p className="text-xs text-red-400/60 leading-relaxed">Видалення акаунта призведе до повної втрати історії чатів та налаштувань. Дія незворотна.</p>
        {!showDeleteZone ? (
          <Button onClick={() => setShowDeleteZone(true)} variant="outline" className="w-full border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white rounded-xl font-black uppercase tracking-widest text-[10px] h-12">ВИДАЛИТИ АКАУНТ</Button>
        ) : (
          <div className="space-y-4">
            <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Введіть DELETE для підтвердження:</p>
            <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="bg-black/20 border-red-500/40 text-center text-red-400 rounded-xl font-mono" />
            <div className="flex gap-2">
              <Button onClick={() => { setShowDeleteZone(false); setDeleteConfirm("") }} className="flex-1 rounded-xl bg-white/5 text-white text-[10px] font-bold h-10">СКАСУВАТИ</Button>
              <Button onClick={handleDelete} disabled={deleteConfirm !== 'DELETE' || deleting} className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold h-10">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "ВИДАЛИТИ"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </motion.div>
  )
}

// ── Tab: Usage
function UsageTab({ profile }: { profile: Profile }) {
  const used = profile.requests_this_month ?? 0; const limit = profile.monthly_limit;
  const pct = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0; const isUnlim = limit === null
  const resetAt = profile.limit_reset_at ? new Date(profile.limit_reset_at) : null
  const resetLabel = resetAt ? resetAt.toLocaleDateString("uk-UA", { day: "numeric", month: "long" }) : "—"
  const now = new Date()
  const daysLeft = resetAt ? Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 86400000)) : 30

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8 max-w-xl pb-10">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-8 rounded-[2rem] bg-[#0d1120]/60 border border-[#BFA071]/10 backdrop-blur-md">
          <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] mb-4 text-center">Всього консультацій</p>
          <div className="flex flex-col items-center gap-1">
            <span className="text-5xl font-serif font-bold text-[#E0E6ED]">{profile.total_requests}</span>
            <span className="text-[10px] text-[#BFA071]/50 font-bold uppercase">за весь час</span>
          </div>
        </div>
        <div className="p-8 rounded-[2rem] bg-[#0d1120]/60 border border-[#BFA071]/10 backdrop-blur-md">
          <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] mb-4 text-center">Місячний ліміт</p>
          <div className="flex flex-col items-center gap-1">
            <span className="text-5xl font-serif font-bold text-[#BFA071]">{isUnlim ? "∞" : limit}</span>
            <span className="text-[10px] text-[#BFA071]/50 font-bold uppercase">{isUnlim ? "необмежено" : "запитів на 30 днів"}</span>
          </div>
        </div>
      </div>

      <div className="p-10 rounded-[2.5rem] bg-[#0d1120] border border-[#BFA071]/20 shadow-2xl relative overflow-hidden group">
        <div className="relative z-10">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h3 className="text-xl font-serif font-bold text-[#E0E6ED]">Використання ліміту</h3>
              <p className="text-xs text-[#BFA071]/60 font-medium">Оновлення: {resetLabel}</p>
            </div>
            <div className="text-right">
              <span className="text-4xl font-bold text-[#BFA071]">{pct}%</span>
            </div>
          </div>

          {!isUnlim && (
            <div className="w-full bg-[#0A0E1A] rounded-full h-3.5 overflow-hidden border border-[#BFA071]/10 p-0.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-[#BFA071]/60 to-[#BFA071] shadow-[0_0_15px_rgba(191,160,113,0.4)]"
              />
            </div>
          )}

          <div className="flex justify-between items-center mt-8">
            <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em] flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Скидання через {daysLeft} дн.
            </p>
            <p className="text-[10px] font-black text-[#BFA071]/70 uppercase tracking-[0.2em]">
              {isUnlim ? "Безліміт активний" : `Залишилось ${limit! - used} запитів`}
            </p>
          </div>
        </div>
      </div>

      {!isUnlim && pct >= 90 && (
        <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-4">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Ліміт майже вичерпано</p>
            <p className="text-xs text-amber-500/60 mt-1">Зверніться до підтримки для розширення або зачекайте оновлення {resetLabel}.</p>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ── Tab: Billing
type PlanData = {
  id: string; name: string; price_uah: number; billing_period: string
  request_limit: number | null; badge_text: string | null; badge_color: string
  main_benefit: string | null; button_text: string; note_text: string | null
  extra_text: string | null; is_active: boolean; sort_order: number
  benefits: { id: number; category: string; text: string; sort_order: number }[]
  features: string[]
}

const CATEGORY_LABELS: Record<string, string> = { requests: "Запити", sources: "Джерела", response: "Відповідь" }

function BillingTab({ profile }: { profile: Profile }) {
  const [plans, setPlans] = useState<PlanData[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)

  useEffect(() => {
    fetch("/api/plans").then(r => r.json()).then(setPlans).catch(() => {}).finally(() => setLoadingPlans(false))
  }, [])

  const currentTier = profile.subscription_tier

  const priceLabel = (plan: PlanData) => {
    if (plan.price_uah === 0) return { price: "0 грн", period: "" }
    if (plan.billing_period === "day") return { price: `${plan.price_uah} грн`, period: "/ день" }
    return { price: `${plan.price_uah} грн`, period: "/ місяць" }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 pb-10">
      {/* Plans grid */}
      {loadingPlans ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <div key={i} className="h-96 rounded-[2rem] bg-[#BFA071]/5 animate-pulse" style={{ animationDelay: `${i*70}ms` }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-8">
          {plans.map(plan => {
            const isCurrent = plan.id === currentTier || (plan.id === "pro" && ["pro","ultra"].includes(currentTier))
            const { price, period } = priceLabel(plan)
            const benefitsByCategory = plan.benefits.reduce((acc, b) => {
              if (!acc[b.category]) acc[b.category] = []
              acc[b.category].push(b)
              return acc
            }, {} as Record<string, typeof plan.benefits>)

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-[2rem] border-2 p-6 transition-all duration-300 ${
                  isCurrent
                    ? "border-[#BFA071] bg-[#BFA071]/5 shadow-2xl shadow-[#BFA071]/10"
                    : plan.badge_color === "emerald"
                    ? "border-emerald-500/20 bg-[#0d1120]/60 hover:border-emerald-500/40"
                    : "border-[#BFA071]/10 bg-[#0d1120]/60 hover:border-[#BFA071]/25"
                }`}
              >
                {/* Active badge */}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[9px] font-black bg-[#BFA071] text-[#0A0E1A] uppercase tracking-widest shadow-lg whitespace-nowrap">
                    ВАШ ТАРИФ
                  </div>
                )}

                {/* Plan badge */}
                {plan.badge_text && !isCurrent && (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-wider whitespace-nowrap border ${
                    plan.badge_color === "emerald"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-[#BFA071]/10 text-[#BFA071] border-[#BFA071]/30"
                  }`}>
                    {plan.badge_text}
                  </div>
                )}

                {/* Header */}
                <div className="mt-2 mb-4">
                  <h3 className="text-xl font-serif font-bold text-white">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-[#BFA071]">{price}</span>
                    {period && <span className="text-xs text-[#BFA071]/50 font-medium">{period}</span>}
                  </div>
                </div>

                {/* Benefits */}
                <div className="flex-1 space-y-4 mb-6">
                  {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
                    const items = benefitsByCategory[cat] ?? []
                    if (items.length === 0) return null
                    return (
                      <div key={cat}>
                        <p className="text-[9px] font-black text-[#BFA071]/40 uppercase tracking-[0.2em] mb-1.5">{catLabel}</p>
                        <ul className="space-y-1.5">
                          {items.map(b => (
                            <li key={b.id} className="flex items-start gap-2 text-xs text-[#E0E6ED]/70">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#BFA071]/60 shrink-0 mt-0.5" />
                              {b.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>

                {/* Main benefit */}
                {plan.main_benefit && (
                  <p className="text-[10px] text-[#BFA071]/50 mb-4 leading-relaxed">
                    → {plan.main_benefit}
                  </p>
                )}

                {/* Extra text (Pro) */}
                {plan.extra_text && (
                  <p className="text-[10px] text-[#E0E6ED]/30 mb-4 leading-relaxed whitespace-pre-line">
                    {plan.extra_text}
                  </p>
                )}

                {/* Button */}
                <button
                  disabled={isCurrent}
                  className={`w-full h-12 rounded-2xl font-black uppercase tracking-[0.15em] text-[10px] transition-all active:scale-95 ${
                    isCurrent
                      ? "bg-[#BFA071] text-[#0A0E1A] cursor-default"
                      : plan.price_uah === 0
                      ? "bg-[#BFA071]/10 border border-[#BFA071]/30 text-[#BFA071] hover:bg-[#BFA071]/20"
                      : "bg-[#BFA071]/5 border border-[#BFA071]/10 text-[#BFA071]/30 cursor-not-allowed"
                  }`}
                >
                  {isCurrent ? "Активний" : plan.price_uah === 0 ? plan.button_text : `${plan.button_text} (незабаром)`}
                </button>

                {/* Note */}
                {plan.note_text && (
                  <p className="text-[9px] text-center text-[#E0E6ED]/30 mt-2 font-medium">{plan.note_text}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Transaction history placeholder */}
      <div className="p-8 rounded-[2rem] bg-[#0d1120]/40 border border-[#BFA071]/10 text-center flex flex-col items-center gap-4">
        <History className="w-6 h-6 text-[#BFA071]/20" />
        <p className="text-[10px] font-bold text-[#BFA071]/70 uppercase tracking-[0.25em]">Історія транзакцій</p>
        <p className="text-xs text-white/30 italic">Архів платежів поки що порожній</p>
      </div>
    </motion.div>
  )
}

// ── Main Page
function SettingsPage() {
  const { data: profile, error } = useSWR<Profile>("/api/settings/profile", fetcher)
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") ?? "profile"

  return (
    <div className="flex h-screen bg-[#0A0E1A] text-[#E0E6ED] overflow-hidden relative">
      <AuthBg />
      <ChatSidebar currentChatId={null} onNewChat={() => router.push('/')} onSelectChat={(id) => router.push(`/?chat=${id}`)} navigateOnSelect />

      <main className="flex-1 flex flex-col relative z-10 bg-[#0d1120]/40 backdrop-blur-sm border-l border-[#BFA071]/10 overflow-hidden">
        <header className="h-16 border-b border-[#BFA071]/10 flex items-center px-8 justify-between bg-[#0A0E1A]/60 backdrop-blur-md sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-[#BFA071]/10 p-2 rounded-lg border border-[#BFA071]/20">
              <Scale className="h-5 w-5 text-[#BFA071]" />
            </div>
            <h1 className="font-serif text-lg font-bold tracking-tight">URAI <span className="text-[#BFA071]">Settings</span></h1>
          </div>
          <Button onClick={() => router.push('/')} variant="ghost" className="text-[#BFA071] hover:bg-[#BFA071]/10 text-xs font-bold gap-2 rounded-xl h-10 uppercase tracking-widest px-5">На головну</Button>
        </header>

        <div className="flex-1 overflow-y-auto scroll-smooth custom-scrollbar">
          <div className="max-w-4xl mx-auto w-full px-8 py-14">
            {!profile ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-[#BFA071]" />
                <span className="text-[10px] font-black text-[#BFA071] uppercase tracking-[0.4em] animate-pulse">Синхронізація профілю...</span>
              </div>
            ) : (
              <Tabs defaultValue={activeTab} className="space-y-12">
                <TabsList className="bg-[#0d1120] p-1.5 rounded-2xl border border-[#BFA071]/10 inline-flex shadow-2xl overflow-x-auto max-w-full no-scrollbar">
                  {["profile", "usage", "billing", "security"].map((tab) => (
                    <TabsTrigger
                      key={tab}
                      value={tab}
                      className="rounded-xl px-8 py-2.5 text-[#BFA071]/70 data-[state=active]:bg-[#BFA071]/10
                        data-[state=active]:text-[#BFA071] data-[state=active]:border
                        data-[state=active]:border-[#BFA071]/30 font-black text-[11px]
                        uppercase tracking-[0.2em] transition-all duration-300 shrink-0 hover:text-[#BFA071]/70"
                    >
                      {tab === "profile" ? "Профіль" : tab === "usage" ? "Використання" : tab === "billing" ? "Тарифи" : "Безпека"}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <TabsContent value="profile" className="mt-0 outline-none"><ProfileTab profile={profile} /></TabsContent>
                  <TabsContent value="usage" className="mt-0 outline-none"><UsageTab profile={profile} /></TabsContent>
                  <TabsContent value="billing" className="mt-0 outline-none"><BillingTab profile={profile} /></TabsContent>
                  <TabsContent value="security" className="mt-0 outline-none"><SecurityTab profile={profile} /></TabsContent>
                </div>
              </Tabs>
            )}
          </div>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #BFA07120; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #BFA07140; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  )
}