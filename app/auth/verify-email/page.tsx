"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Scale, Loader2, Mail, RefreshCw, CheckCircle2, ArrowLeft } from "lucide-react"
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

const RESEND_COOLDOWN = 60 // seconds

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const supabase = createClient()

  const email = searchParams.get("email") ?? ""
  const [cooldown, setCooldown] = useState(0)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [error, setError] = useState("")

  // Countdown timer
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = async () => {
    if (!email || cooldown > 0) return
    setResendLoading(true)
    setError("")
    setResendSuccess(false)

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setResendLoading(false)

    if (error) {
      setError("Не вдалося відправити лист. Спробуйте ще раз.")
      return
    }

    setResendSuccess(true)
    setCooldown(RESEND_COOLDOWN)
  }

  return (
    <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-8">
      {/* Mail icon */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl bg-[#BFA071]/10 border border-[#BFA071]/20 flex items-center justify-center">
            <Mail className="w-10 h-10 text-[#BFA071]" strokeWidth={1.5} />
          </div>
          <span className="absolute -top-1 -right-1 flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#BFA071] opacity-40" />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-[#BFA071] shadow-lg shadow-[#BFA071]/50" />
          </span>
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-serif font-bold text-white mb-3">Перевірте вашу пошту</h2>
        <p className="text-sm text-[#E0E6ED]/60 leading-relaxed max-w-[280px] mx-auto">
          Ми надіслали посилання для підтвердження на{" "}
          {email ? (
            <span className="font-bold text-[#BFA071] break-all">{email}</span>
          ) : (
            <span className="italic">вашу адресу</span>
          )}
          . Перейдіть за ним, щоб активувати акаунт.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-4 mb-8">
        {[
          "Відкрийте лист від Lawyer AI",
          "Натисніть кнопку «Підтвердити email»",
          "Вас автоматично перенаправить до сервісу",
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-4 group">
            <div className="w-8 h-8 rounded-xl bg-[#0A0E1A] border border-[#BFA071]/20 text-[#BFA071] flex items-center justify-center shrink-0 font-serif font-bold text-xs group-hover:border-[#BFA071]/50 transition-colors">
              {i + 1}
            </div>
            <span className="text-xs font-medium text-[#E0E6ED]/70 uppercase tracking-widest">{step}</span>
          </div>
        ))}
      </div>

      {/* Success message */}
      {resendSuccess && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-6">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Лист надіслано повторно!
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Resend button */}
      <Button
        className="w-full h-14 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.15em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40"
        onClick={handleResend}
        disabled={resendLoading || cooldown > 0 || !email}
      >
        {resendLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            {cooldown > 0 ? `Зачекайте (${cooldown}с)` : "Відправити лист ще раз"}
          </div>
        )}
      </Button>

      <p className="text-[10px] text-[#BFA071]/70 font-black uppercase tracking-widest text-center mt-4">
        Перевірте папку «Спам», якщо лист не надійшов
      </p>

      {/* Footer links */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#BFA071]/10">
        <Link
          href="/auth/login"
          className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all flex items-center gap-2"
        >
          <ArrowLeft className="w-3 h-3" /> Увійти
        </Link>
        <Link
          href="/auth/register"
          className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all"
        >
          Інший email
        </Link>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
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

        <Suspense fallback={
          <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/10 rounded-[2.5rem] p-8 flex items-center justify-center h-[420px]">
            <Loader2 className="w-8 h-8 animate-spin text-[#BFA071]" />
          </div>
        }>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  )
}
