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
  ChevronRight, Zap, Star, Infinity, Scale, History, Bot, RefreshCw, Save, Compass
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
  ai_personal_prompt: string | null;
  tour_completed: boolean | null;
  response_length_pref: "short" | "standard" | "detailed" | "full" | null;
  response_lang_style: "legal" | "plain" | null;
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
      <div className="absolute top-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-[#C9A84C]/5 blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-[#C9A84C]/3 blur-[120px]" />
    </div>
  );
}

// ── Tab: Profile
const AI_PROMPT_MAX = 800

function ProfileTab({ profile }: { profile: Profile }) {
  const [fullName, setFullName] = useState(profile.full_name ?? "")
  const [role, setRole] = useState(profile.role ?? "")
  const [segments, setSegments] = useState<Segment[]>(profile.segment ?? [])
  const [marketingConsent, setMarketingConsent] = useState(profile.marketing_consent ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [, startTransition] = useTransition()

  // AI Personal Prompt
  const [aiPrompt, setAiPrompt] = useState(profile.ai_personal_prompt ?? "")
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptSaved, setPromptSaved] = useState(false)
  const [promptGenerating, setPromptGenerating] = useState(false)
  const [promptError, setPromptError] = useState("")

  // Response style preferences
  const [responseLength, setResponseLength] = useState<"short" | "standard" | "detailed" | "full">(profile.response_length_pref ?? "standard")
  const [responseLang, setResponseLang] = useState<"legal" | "plain">(profile.response_lang_style ?? "legal")
  const [styleSaving, setStyleSaving] = useState(false)
  const [styleSaved, setStyleSaved] = useState(false)
  const [styleError, setStyleError] = useState("")

  const tier = profile.subscription_tier
  const isBasicPlus = tier === "basic" || tier === "pro" || tier === "ultra"
  const isProPlus   = tier === "pro" || tier === "ultra"

  const handleSaveStyle = async () => {
    setStyleSaving(true); setStyleError(""); setStyleSaved(false)
    const res = await fetch("/api/settings/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_length_pref: responseLength, response_lang_style: responseLang }),
    })
    setStyleSaving(false)
    if (res.ok) {
      setStyleSaved(true); startTransition(() => { mutate("/api/settings/profile") })
      setTimeout(() => setStyleSaved(false), 3000)
    } else { setStyleError("Помилка збереження.") }
  }

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

  const handleSavePrompt = async () => {
    setPromptSaving(true); setPromptError(""); setPromptSaved(false)
    const res = await fetch("/api/settings/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_personal_prompt: aiPrompt }),
    })
    setPromptSaving(false)
    if (res.ok) {
      setPromptSaved(true); startTransition(() => { mutate("/api/settings/profile") })
      setTimeout(() => setPromptSaved(false), 3000)
    } else { setPromptError("Помилка збереження.") }
  }

  const handleGeneratePrompt = async () => {
    setPromptGenerating(true); setPromptError("")
    const res = await fetch("/api/user/generate-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    setPromptGenerating(false)
    if (res.ok) {
      const data = await res.json()
      setAiPrompt(data.prompt ?? "")
      setPromptSaved(true)
      startTransition(() => { mutate("/api/settings/profile") })
      setTimeout(() => setPromptSaved(false), 3000)
    } else { setPromptError("Помилка генерації. Спробуйте ще раз.") }
  }

  const [tourResetting, setTourResetting] = useState(false)
  const router = useRouter()
  const handleReplayTour = async () => {
    setTourResetting(true)
    await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tour_completed: false }),
    }).catch(() => {})
    router.push("/chat")
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-xl pb-10">
      <div className="flex items-center gap-6 p-6 rounded-[2rem] bg-[#0d1120]/60 border border-[#C9A84C]/10 backdrop-blur-md">
        <div className="w-20 h-20 rounded-2xl bg-[#C9A84C] flex items-center justify-center text-3xl font-serif font-bold text-[#0A0E1A] shadow-lg shadow-[#C9A84C]/20">
          {(fullName || profile.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-xl font-serif font-bold text-[#E0E6ED]">{fullName || "Користувач"}</h2>
          <p className="text-sm text-[#C9A84C]/60 font-medium">{profile.email}</p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Повне ім&apos;я</Label>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Іваненко Іван Іванович" className="bg-[#0d1120] border-[#C9A84C]/20 rounded-2xl h-12 text-[#E0E6ED] focus:border-[#C9A84C]/50 focus:ring-0" />
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Ваша роль</Label>
          <div className="grid grid-cols-1 gap-2">
            {ROLES.map(r => (
              <button key={r.value} onClick={() => setRole(r.value)} className={`px-5 py-3 rounded-xl border text-left text-sm font-bold transition-all ${role === r.value ? "border-[#C9A84C] bg-[#C9A84C]/10 text-[#C9A84C]" : "border-[#C9A84C]/10 bg-[#0d1120]/40 text-[#E0E6ED]/60 hover:border-[#C9A84C]/30"}`}>
                <div className="flex items-center justify-between">
                  {r.label}
                  {role === r.value && <CheckCircle2 className="w-4 h-4" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Сфери інтересів</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_SEGMENTS.map(s => (
              <button key={s} onClick={() => toggleSegment(s)} className={`px-4 py-2 rounded-full border text-[10px] font-black transition-all uppercase tracking-wider ${segments.includes(s) ? "border-[#C9A84C] bg-[#C9A84C] text-[#0A0E1A]" : "border-[#C9A84C]/20 text-[#C9A84C]/60 hover:border-[#C9A84C]/40"}`}>
                {SEGMENT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Marketing consent */}
        <button
          type="button"
          onClick={() => setMarketingConsent(v => !v)}
          className={`w-full flex items-start gap-4 px-5 py-4 rounded-2xl border transition-all text-left ${marketingConsent ? "border-[#C9A84C]/30 bg-[#C9A84C]/5" : "border-[#C9A84C]/10 bg-transparent hover:border-[#C9A84C]/20"}`}
        >
          <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${marketingConsent ? "border-[#C9A84C] bg-[#C9A84C]" : "border-[#C9A84C]/30"}`}>
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

      <button onClick={handleSave} disabled={saving} className="h-14 w-full rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-widest shadow-lg shadow-[#C9A84C]/10 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <CheckCircle2 className="w-5 h-5" /> : "ЗБЕРЕГТИ ЗМІНИ"}
      </button>

      {/* ── AI Personal Prompt ── */}
      <div className="mt-4 rounded-[1.5rem] border border-[#C9A84C]/15 bg-[#0d1120]/60 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center">
            <Bot className="w-4.5 h-4.5 text-[#C9A84C]" />
          </div>
          <div>
            <p className="text-sm font-black text-[#E0E6ED] uppercase tracking-wider">Персональний AI-профіль</p>
            <p className="text-[11px] text-[#C9A84C]/50 mt-0.5">Впливає на відповіді у чаті</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[12px] text-[#E0E6ED]/60 leading-relaxed">
          <strong className="text-[#C9A84C]/80">Що це?</strong> AI використовує цей текст щоб адаптувати відповіді під вас — враховує вашу спеціалізацію, рівень знань та сфери інтересів. Можна згенерувати автоматично або написати вручну.
        </div>

        <div className="space-y-2">
          <div className="relative">
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value.slice(0, AI_PROMPT_MAX))}
              rows={5}
              placeholder="Опишіть себе як юриста: спеціалізацію, досвід, на що звертати увагу у відповідях..."
              className="w-full bg-[#0A0E1A]/80 border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 focus:border-[#C9A84C]/50 rounded-2xl px-4 py-3 text-sm text-[#E0E6ED] placeholder:text-[#E0E6ED]/25 outline-none transition-colors resize-none pb-7"
            />
            <span className={`absolute bottom-2.5 right-3.5 text-[10px] font-mono transition-colors ${aiPrompt.length >= AI_PROMPT_MAX ? "text-red-400" : aiPrompt.length >= AI_PROMPT_MAX * 0.85 ? "text-amber-400" : "text-[#E0E6ED]/30"}`}>
              {aiPrompt.length}/{AI_PROMPT_MAX}
            </span>
          </div>

          {promptError && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {promptError}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleGeneratePrompt}
              disabled={promptGenerating}
              className="flex-1 h-10 rounded-xl border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/70 hover:text-[#C9A84C] text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {promptGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Згенерувати з профілю
            </button>
            <button
              onClick={handleSavePrompt}
              disabled={promptSaving || aiPrompt === (profile.ai_personal_prompt ?? "")}
              className="flex-1 h-10 rounded-xl bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20 border border-[#C9A84C]/30 text-[#C9A84C] text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {promptSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : promptSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {promptSaved ? "Збережено" : "Зберегти"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Response Style ── */}
      <div className="mt-4 rounded-[1.5rem] border border-[#C9A84C]/15 bg-[#0d1120]/60 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#C9A84C]/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-[#C9A84C]" />
          </div>
          <div>
            <p className="text-sm font-black text-[#E0E6ED] uppercase tracking-wider">Стиль відповідей AI</p>
            <p className="text-[11px] text-[#C9A84C]/50 mt-0.5">Застосовується до всіх чатів</p>
          </div>
        </div>

        {/* Length */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Довжина відповіді</p>
          <div className="space-y-2">
            {([
              { value: "short",    label: "Коротко",       desc: "Суть за 1–2 абзаци",                   lock: false },
              { value: "standard", label: "Стандарт",      desc: "Збалансована відповідь",                lock: false },
              { value: "detailed", label: "Розгорнуто",    desc: "З деталями, нюансами та виключеннями", lock: !isBasicPlus, plan: "Basic+" },
              { value: "full",     label: "Повний аналіз", desc: "Глибокий розбір на 1–2 сторінки",      lock: !isProPlus,   plan: "Pro+" },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => !opt.lock && setResponseLength(opt.value)}
                disabled={opt.lock}
                className={`w-full px-4 py-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 ${
                  responseLength === opt.value && !opt.lock
                    ? "border-[#C9A84C] bg-[#C9A84C]/10"
                    : opt.lock
                    ? "border-[#C9A84C]/8 bg-transparent opacity-50 cursor-not-allowed"
                    : "border-[#C9A84C]/10 bg-[#0d1120]/40 hover:border-[#C9A84C]/30"
                }`}
              >
                <div>
                  <p className={`text-sm font-bold ${responseLength === opt.value && !opt.lock ? "text-[#C9A84C]" : "text-[#E0E6ED]/80"}`}>{opt.label}</p>
                  <p className="text-[11px] text-[#E0E6ED]/40 mt-0.5">{opt.desc}</p>
                </div>
                <div className="shrink-0">
                  {opt.lock
                    ? <span className="text-[9px] font-black text-[#C9A84C]/40 border border-[#C9A84C]/20 rounded-full px-2 py-0.5 uppercase tracking-wider">🔒 {opt.plan}</span>
                    : responseLength === opt.value
                    ? <CheckCircle2 className="w-4 h-4 text-[#C9A84C]" />
                    : null
                  }
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Language style */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Мова відповіді</p>
          <div className="space-y-2">
            {([
              { value: "legal", label: "Юридична мова", desc: "Точні терміни НПА, як у законодавстві", lock: false },
              { value: "plain", label: "Простою мовою", desc: "Без жаргону, зрозуміло клієнту",         lock: !isBasicPlus, plan: "Basic+" },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => !opt.lock && setResponseLang(opt.value)}
                disabled={opt.lock}
                className={`w-full px-4 py-3 rounded-xl border text-left transition-all flex items-center justify-between gap-3 ${
                  responseLang === opt.value && !opt.lock
                    ? "border-[#C9A84C] bg-[#C9A84C]/10"
                    : opt.lock
                    ? "border-[#C9A84C]/8 bg-transparent opacity-50 cursor-not-allowed"
                    : "border-[#C9A84C]/10 bg-[#0d1120]/40 hover:border-[#C9A84C]/30"
                }`}
              >
                <div>
                  <p className={`text-sm font-bold ${responseLang === opt.value && !opt.lock ? "text-[#C9A84C]" : "text-[#E0E6ED]/80"}`}>{opt.label}</p>
                  <p className="text-[11px] text-[#E0E6ED]/40 mt-0.5">{opt.desc}</p>
                </div>
                <div className="shrink-0">
                  {opt.lock
                    ? <span className="text-[9px] font-black text-[#C9A84C]/40 border border-[#C9A84C]/20 rounded-full px-2 py-0.5 uppercase tracking-wider">🔒 {opt.plan}</span>
                    : responseLang === opt.value
                    ? <CheckCircle2 className="w-4 h-4 text-[#C9A84C]" />
                    : null
                  }
                </div>
              </button>
            ))}
          </div>
        </div>

        {styleError && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertCircle size={12} /> {styleError}</p>}

        <button
          onClick={handleSaveStyle}
          disabled={styleSaving || (responseLength === (profile.response_length_pref ?? "standard") && responseLang === (profile.response_lang_style ?? "legal"))}
          className="w-full h-10 rounded-xl bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20 border border-[#C9A84C]/30 text-[#C9A84C] text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {styleSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : styleSaved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {styleSaved ? "Збережено" : "Зберегти стиль"}
        </button>
      </div>

      {/* ── Replay Tour ── */}
      <button
        onClick={handleReplayTour}
        disabled={tourResetting}
        className="w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-[#C9A84C]/10 hover:border-[#C9A84C]/25 hover:bg-[#C9A84C]/5 text-[#C9A84C]/50 hover:text-[#C9A84C]/80 transition-all text-xs font-bold disabled:opacity-40"
      >
        {tourResetting
          ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          : <Compass className="w-4 h-4 shrink-0" />
        }
        <span>Переглянути гайд по інтерфейсу</span>
        <ChevronRight className="w-3.5 h-3.5 ml-auto" />
      </button>
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
        <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Остання активність</Label>
        <div className="p-6 rounded-3xl bg-[#0d1120]/60 border border-[#C9A84C]/10 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center text-[#C9A84C]"><Monitor className="w-5 h-5" /></div>
            <div>
              <p className="text-sm font-bold text-[#E0E6ED]">{formatUA(profile.user_agent)} · {formatOS(profile.user_agent)}</p>
              <p className="text-[10px] text-[#C9A84C]/60 flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />
                {profile.last_city && profile.last_country ? `${profile.last_city}, ${profile.last_country}` : profile.last_ip ?? "Місце невідоме"}
              </p>
            </div>
          </div>
          <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full tracking-widest">ПОТОЧНА</span>
        </div>
      </section>

      <section className="space-y-6">
        <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Зміна пароля</Label>
        {profile.auth_provider !== 'email' ? (
          <div className="p-5 rounded-2xl bg-[#0d1120] border border-[#C9A84C]/15 flex items-start gap-4">
            <Shield className="w-5 h-5 text-[#C9A84C]/70 mt-0.5" />
            <div className="text-xs text-[#E0E6ED]/60 leading-relaxed">
              Ваш акаунт пов&apos;язаний з {profile.auth_provider === "google" ? "Google" : profile.auth_provider}.
              Керуйте безпекою в налаштуваннях провайдера.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} placeholder="Поточний пароль" className="bg-[#0d1120] border-[#C9A84C]/20 rounded-2xl h-12 text-[#E0E6ED] pr-12 focus:border-[#C9A84C]/50 focus-visible:ring-0" />
              <button onClick={() => setShowCurrent(!showCurrent)} className="absolute right-4 top-3.5 text-[#C9A84C]/70 hover:text-[#C9A84C]">{showCurrent ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Новий пароль (мін. 6 символів)" className="bg-[#0d1120] border-[#C9A84C]/20 rounded-2xl h-12 text-[#E0E6ED] pr-12 focus:border-[#C9A84C]/50 focus-visible:ring-0" />
              <button onClick={() => setShowNew(!showNew)} className="absolute right-4 top-3.5 text-[#C9A84C]/70 hover:text-[#C9A84C]">{showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
            {pwdMsg && <div className={`text-xs p-3 rounded-xl border flex items-center gap-2 ${pwdMsg.type === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>{pwdMsg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />} {pwdMsg.text}</div>}
            <button onClick={handleChangePassword} disabled={pwdSaving || !currentPwd || !newPwd} className="w-full h-12 rounded-2xl bg-[#C9A84C]/10 border border-[#C9A84C]/30 hover:bg-[#C9A84C]/20 hover:border-[#C9A84C]/60 text-[#C9A84C] font-black text-[11px] tracking-widest uppercase transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed">ОНОВИТИ ПАРОЛЬ</button>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <Label className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] ml-1">Сесія</Label>
        <button onClick={handleLogout} className="h-12 gap-2 w-full flex items-center justify-center rounded-2xl bg-[#0d1120] border border-[#C9A84C]/25 hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 text-[#E0E6ED] uppercase font-black text-[10px] tracking-widest transition-all active:scale-95">
          <LogOut className="w-4 h-4 text-[#C9A84C]" /> Вийти з акаунта
        </button>
      </section>

      <section className="p-8 rounded-[2rem] border border-red-500/20 bg-red-500/5 space-y-5">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <h3 className="font-serif font-bold">Небезпечна зона</h3>
        </div>
        <p className="text-xs text-red-400/60 leading-relaxed">Видалення акаунта призведе до повної втрати історії чатів та налаштувань. Дія незворотна.</p>
        {!showDeleteZone ? (
          <button onClick={() => setShowDeleteZone(true)} className="w-full bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/60 rounded-xl font-black uppercase tracking-widest text-[10px] h-12 transition-all active:scale-95">ВИДАЛИТИ АКАУНТ</button>
        ) : (
          <div className="space-y-4">
            <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Введіть DELETE для підтвердження:</p>
            <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="bg-[#0A0E1A] border-red-500/40 text-center text-red-400 rounded-xl font-mono focus-visible:ring-0" />
            <div className="flex gap-2">
              <button onClick={() => { setShowDeleteZone(false); setDeleteConfirm("") }} className="flex-1 rounded-xl bg-[#0d1120] border border-[#C9A84C]/20 text-[#E0E6ED]/70 hover:border-[#C9A84C]/40 text-[10px] font-bold h-10 transition-all">СКАСУВАТИ</button>
              <button onClick={handleDelete} disabled={deleteConfirm !== 'DELETE' || deleting} className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold h-10 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "ВИДАЛИТИ"}
              </button>
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
        <div className="p-8 rounded-[2rem] bg-[#0d1120]/60 border border-[#C9A84C]/10 backdrop-blur-md">
          <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] mb-4 text-center">Всього консультацій</p>
          <div className="flex flex-col items-center gap-1">
            <span className="text-5xl font-serif font-bold text-[#E0E6ED]">{profile.total_requests}</span>
            <span className="text-[10px] text-[#C9A84C]/50 font-bold uppercase">за весь час</span>
          </div>
        </div>
        <div className="p-8 rounded-[2rem] bg-[#0d1120]/60 border border-[#C9A84C]/10 backdrop-blur-md">
          <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] mb-4 text-center">Місячний ліміт</p>
          <div className="flex flex-col items-center gap-1">
            <span className="text-5xl font-serif font-bold text-[#C9A84C]">{isUnlim ? "∞" : limit}</span>
            <span className="text-[10px] text-[#C9A84C]/50 font-bold uppercase">{isUnlim ? "необмежено" : "запитів на 30 днів"}</span>
          </div>
        </div>
      </div>

      <div className="p-10 rounded-[2.5rem] bg-[#0d1120] border border-[#C9A84C]/20 shadow-2xl relative overflow-hidden group">
        <div className="relative z-10">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h3 className="text-xl font-serif font-bold text-[#E0E6ED]">Використання ліміту</h3>
              <p className="text-xs text-[#C9A84C]/60 font-medium">Оновлення: {resetLabel}</p>
            </div>
            <div className="text-right">
              <span className="text-4xl font-bold text-[#C9A84C]">{pct}%</span>
            </div>
          </div>

          {!isUnlim && (
            <div className="w-full bg-[#0A0E1A] rounded-full h-3.5 overflow-hidden border border-[#C9A84C]/10 p-0.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-[#C9A84C]/60 to-[#C9A84C] shadow-[0_0_15px_rgba(201,168,76,0.4)]"
              />
            </div>
          )}

          <div className="flex justify-between items-center mt-8">
            <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em] flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Скидання через {daysLeft} дн.
            </p>
            <p className="text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-[0.2em]">
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
          {[0,1,2,3].map(i => <div key={i} className="h-96 rounded-[2rem] bg-[#C9A84C]/5 animate-pulse" style={{ animationDelay: `${i*70}ms` }} />)}
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
                    ? "border-[#C9A84C] bg-[#C9A84C]/5 shadow-2xl shadow-[#C9A84C]/10"
                    : plan.badge_color === "emerald"
                    ? "border-emerald-500/20 bg-[#0d1120]/60 hover:border-emerald-500/40"
                    : "border-[#C9A84C]/10 bg-[#0d1120]/60 hover:border-[#C9A84C]/25"
                }`}
              >
                {/* Active badge */}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[9px] font-black bg-[#C9A84C] text-[#0A0E1A] uppercase tracking-widest shadow-lg whitespace-nowrap">
                    ВАШ ТАРИФ
                  </div>
                )}

                {/* Plan badge */}
                {plan.badge_text && !isCurrent && (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-wider whitespace-nowrap border ${
                    plan.badge_color === "emerald"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/30"
                  }`}>
                    {plan.badge_text}
                  </div>
                )}

                {/* Header */}
                <div className="mt-2 mb-4">
                  <h3 className="text-xl font-serif font-bold text-white">{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-[#C9A84C]">{price}</span>
                    {period && <span className="text-xs text-[#C9A84C]/50 font-medium">{period}</span>}
                  </div>
                </div>

                {/* Benefits */}
                <div className="flex-1 space-y-4 mb-6">
                  {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
                    const items = benefitsByCategory[cat] ?? []
                    if (items.length === 0) return null
                    return (
                      <div key={cat}>
                        <p className="text-[9px] font-black text-[#C9A84C]/40 uppercase tracking-[0.2em] mb-1.5">{catLabel}</p>
                        <ul className="space-y-1.5">
                          {items.map(b => (
                            <li key={b.id} className="flex items-start gap-2 text-xs text-[#E0E6ED]/70">
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#C9A84C]/60 shrink-0 mt-0.5" />
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
                  <p className="text-[10px] text-[#C9A84C]/50 mb-4 leading-relaxed">
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
                      ? "bg-[#C9A84C] text-[#0A0E1A] cursor-default"
                      : plan.price_uah === 0
                      ? "bg-[#C9A84C]/10 border border-[#C9A84C]/30 text-[#C9A84C] hover:bg-[#C9A84C]/20"
                      : "bg-[#C9A84C]/5 border border-[#C9A84C]/10 text-[#C9A84C]/30 cursor-not-allowed"
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
      <div className="p-8 rounded-[2rem] bg-[#0d1120]/40 border border-[#C9A84C]/10 text-center flex flex-col items-center gap-4">
        <History className="w-6 h-6 text-[#C9A84C]/20" />
        <p className="text-[10px] font-bold text-[#C9A84C]/70 uppercase tracking-[0.25em]">Історія транзакцій</p>
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
      <ChatSidebar currentChatId={null} onNewChat={() => router.push('/chat')} onSelectChat={(id) => router.push(`/chat?chat=${id}`)} navigateOnSelect />

      <main className="flex-1 flex flex-col relative z-10 bg-[#0d1120]/40 backdrop-blur-sm border-l border-[#C9A84C]/10 overflow-hidden">
        <header className="h-16 border-b border-[#C9A84C]/10 flex items-center px-8 justify-between bg-[#0A0E1A]/60 backdrop-blur-md sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-[#C9A84C]/10 p-2 rounded-lg border border-[#C9A84C]/20">
              <Scale className="h-5 w-5 text-[#C9A84C]" />
            </div>
            <h1 className="font-serif text-lg font-bold tracking-tight">URAI <span className="text-[#C9A84C]">Settings</span></h1>
          </div>
          <button onClick={() => router.push('/')} className="text-[#C9A84C] hover:bg-[#C9A84C]/10 border border-[#C9A84C]/25 hover:border-[#C9A84C]/50 text-xs font-bold gap-2 rounded-xl h-10 px-5 uppercase tracking-widest transition-all flex items-center">На головну</button>
        </header>

        <div className="flex-1 overflow-y-auto scroll-smooth custom-scrollbar">
          <div className="max-w-4xl mx-auto w-full px-8 py-14">
            {!profile ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-[#C9A84C]" />
                <span className="text-[10px] font-black text-[#C9A84C] uppercase tracking-[0.4em] animate-pulse">Синхронізація профілю...</span>
              </div>
            ) : (
              <Tabs defaultValue={activeTab} className="space-y-12">
                <TabsList className="bg-[#0d1120] p-1.5 rounded-2xl border border-[#C9A84C]/10 inline-flex shadow-2xl overflow-x-auto max-w-full no-scrollbar">
                  {["profile", "usage", "billing", "security"].map((tab) => (
                    <TabsTrigger
                      key={tab}
                      value={tab}
                      className="rounded-xl px-8 py-2.5 text-[#C9A84C]/70 data-[state=active]:bg-[#C9A84C]/10
                        data-[state=active]:text-[#C9A84C] data-[state=active]:border
                        data-[state=active]:border-[#C9A84C]/30 font-black text-[11px]
                        uppercase tracking-[0.2em] transition-all duration-300 shrink-0 hover:text-[#C9A84C]/70"
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
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #C9A84C20; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #C9A84C40; }
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