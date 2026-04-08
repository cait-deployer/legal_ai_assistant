"use client"

export const dynamic = 'force-dynamic'

import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Scale, Loader2, AlertCircle, CheckCircle2, ArrowLeft, Lock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { motion, AnimatePresence } from "framer-motion"

function AuthBg() {
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/5 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFA071]/3 blur-[140px]" />
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]" />
    </div>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    // Ініціалізуємо клієнт тільки всередині useEffect
    const supabase = createClient()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true)
      }
    })

    // Перевірка сесії відразу (про всяк випадок, якщо подія вже відбулася)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password.length < 6) {
      setError("Пароль має бути мінімум 6 символів")
      return
    }
    if (password !== confirmPassword) {
      setError("Паролі не збігаються")
      return
    }

    setLoading(true)
    const supabase = createClient()

    try {
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setError("Помилка скидання пароля. Посилання могло застаріти.")
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => router.push("/auth/login"), 2500)
    } catch (err) {
      setError("Сталася помилка зв'язку. Спробуйте ще раз.")
      setLoading(false)
    }
  }

  if (success) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] p-10 text-center shadow-2xl">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
        <h3 className="text-2xl font-serif font-bold text-white mb-3">Пароль змінено</h3>
        <p className="text-sm text-[#E0E6ED]/60 leading-relaxed">
          Ваш доступ успішно відновлено.<br />Перенаправлення до входу...
        </p>
      </motion.div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] p-10 flex flex-col items-center gap-4 text-center shadow-2xl">
        <Loader2 className="w-10 h-10 animate-spin text-[#BFA071]" />
        <p className="text-xs font-black text-[#BFA071] uppercase tracking-[0.3em]">Авторизація посилання...</p>
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-8 relative overflow-hidden">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Lock size={18} className="text-[#BFA071]" />
          <h2 className="text-2xl font-serif font-bold text-white">Новий пароль</h2>
        </div>
        <p className="text-sm text-[#E0E6ED]/60 leading-relaxed">Встановіть новий пароль для захисту акаунта</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em] ml-1">Придумайте пароль</Label>
          <div className="relative group">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Мінімум 6 символів"
              value={password}
              autoComplete="new-password"
              onChange={(e) => { setPassword(e.target.value); setError("") }}
              className="h-14 bg-[#0A0E1A] border-[#BFA071]/20 rounded-2xl text-[#E0E6ED] pr-12 focus:border-[#BFA071]/50 focus:ring-0 transition-all"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-4.5 text-[#BFA071]/50 hover:text-[#BFA071] transition-colors"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em] ml-1">Повторіть пароль</Label>
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="Введіть ще раз"
            value={confirmPassword}
            autoComplete="new-password"
            onChange={(e) => { setConfirmPassword(e.target.value); setError("") }}
            className={`h-14 bg-[#0A0E1A] border-[#BFA071]/20 rounded-2xl text-[#E0E6ED] focus:border-[#BFA071]/50 focus:ring-0 transition-all ${confirmPassword && confirmPassword !== password ? "border-red-500/40" : ""
              }`}
            required
          />
        </div>

        <Button
          type="submit"
          disabled={loading || !password || !confirmPassword}
          className="w-full h-14 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40 mt-4"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "ЗБЕРЕГТИ ПАРОЛЬ"}
        </Button>
      </form>

      <div className="mt-8 pt-6 border-t border-[#BFA071]/10 text-center">
        <Link href="/auth/login" className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2">
          <ArrowLeft size={14} /> ПОВЕРНУТИСЯ ДО ВХОДУ
        </Link>
      </div>
    </motion.div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden p-6">
      <AuthBg />
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 mb-10">
          <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#BFA071] to-[#d4b78a] flex items-center justify-center shadow-2xl ring-4 ring-[#BFA071]/10">
            <Scale className="w-8 h-8 text-[#0A0E1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-serif font-bold tracking-tight text-white">URAI <span className="text-[#BFA071]">Legal</span></h1>
          </div>
        </div>

        <Suspense fallback={
          <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/10 rounded-[2.5rem] p-10 flex items-center justify-center h-[400px]">
            <Loader2 className="w-10 h-10 animate-spin text-[#BFA071]" />
          </div>
        }>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}