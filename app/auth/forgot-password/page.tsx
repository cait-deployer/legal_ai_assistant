"use client"

export const dynamic = 'force-dynamic'

import { Suspense, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Scale, Loader2, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

function AuthBg() {
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/5 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFA071]/3 blur-[140px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-[#BFA071]/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-[#BFA071]/[0.03]" />
      <svg className="absolute inset-0 w-full h-full opacity-[0.015]">
        <defs>
          <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="#BFA071" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    </div>
  )
}

function ForgotPasswordForm() {
  // Клієнт створюємо ТІЛЬКИ всередині handleSubmit, щоб не ламати білд на сервері
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // Ініціалізація клієнта відбувається в момент кліку (клієнтська дія)
      const supabase = createClient()

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })

      if (error) {
        setError("Помилка відправки листа. Перевірте email і спробуйте ще раз.")
        setLoading(false)
        return
      }

      setSuccess(true)
    } catch (err) {
      setError("Сталася непередбачувана помилка. Спробуйте пізніше.")
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-10 text-center">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
        <h3 className="text-2xl font-serif font-bold text-white mb-3">Лист надіслано</h3>
        <p className="text-sm text-[#E0E6ED]/60 leading-relaxed mb-8">
          Ми надіслали посилання для скидання пароля на{" "}
          <span className="font-bold text-[#BFA071]">{email}</span>.
          {" "}Перевірте папку «Спам», якщо лист не з&apos;явився.
        </p>
        <Link href="/auth/login">
          <Button className="w-full h-14 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Повернутись до входу
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-8">
      <div className="mb-7">
        <h2 className="text-2xl font-serif font-bold text-white">Відновлення пароля</h2>
        <p className="text-sm text-[#E0E6ED]/60 mt-1">
          Введіть email — ми надішлемо посилання для скидання
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email" className="text-[10px] font-black text-[#BFA071]/60 uppercase tracking-[0.2em]">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={email}
            autoComplete="email"
            autoFocus
            onChange={(e) => { setEmail(e.target.value); setError("") }}
            className="h-14 bg-[#0A0E1A] border-[#BFA071]/20 rounded-2xl text-[#E0E6ED] placeholder:text-[#BFA071]/20 focus-visible:border-[#BFA071]/50 focus-visible:ring-0"
            required
          />
        </div>

        <Button
          type="submit"
          disabled={loading || !email}
          className="w-full h-14 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40 mt-2"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Надіслати посилання"
          )}
        </Button>
      </form>

      <div className="mt-8 pt-6 border-t border-[#BFA071]/10 text-center">
        <Link
          href="/auth/login"
          className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-3 h-3" /> Назад до входу
        </Link>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden p-4">
      <AuthBg />
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 mb-10">
          <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#BFA071] to-[#d4b78a] flex items-center justify-center shadow-2xl shadow-[#BFA071]/20 ring-4 ring-[#BFA071]/10">
            <Scale className="w-8 h-8 text-[#0A0E1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-serif font-bold tracking-tight text-white">
              Lawyer <span className="text-[#BFA071]">AI</span>
            </h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-0.5">Юридичний асистент на базі AI</p>
          </div>
        </div>

        {/* Suspense захищає білд від помилок рендерингу searchParams або ініціалізації клієнта */}
        <Suspense fallback={
          <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/10 rounded-[2.5rem] p-8 flex items-center justify-center h-[280px]">
            <Loader2 className="w-8 h-8 animate-spin text-[#BFA071]" />
          </div>
        }>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}