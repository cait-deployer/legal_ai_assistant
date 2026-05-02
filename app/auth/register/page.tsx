"use client"

export const dynamic = 'force-dynamic'

import { Suspense, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Image from "next/image"
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

function AuthBg() {
  return (
    <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#C9A84C]/5 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#C9A84C]/3 blur-[140px]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-[#C9A84C]/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-[#C9A84C]/[0.03]" />
      <svg className="absolute inset-0 w-full h-full opacity-[0.015]">
        <defs>
          <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="#C9A84C" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function RegisterForm() {
  const router = useRouter()
  // supabase створюється всередині функцій, щоб не викликати помилок при білді
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const passwordStrength = (() => {
    if (password.length === 0) return null
    if (password.length < 6) return "weak"
    if (password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password)) return "strong"
    return "medium"
  })()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password.length < 6) {
      setError("Пароль має бути мінімум 6 символів")
      return
    }

    setLoading(true)
    const supabase = createClient()

    try {
      const geoPromise = fetch("https://ipapi.co/json/").then(res => res.json()).catch(() => ({}));
      const fingerprint = btoa(`${navigator.userAgent}-${screen.width}x${screen.height}`);

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        },
      })

      if (authError) {
        setError(
          authError.message.includes("already registered")
            ? "Цей email вже зареєстрований. Спробуйте увійти."
            : "Помилка реєстрації. Спробуйте ще раз."
        )
        setLoading(false)
        return
      }

      if (data.user) {
        const geoData = await geoPromise;
        await fetch("/api/auth/login-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: data.user.id,
            fingerprint: fingerprint,
            clientIp: geoData.ip,
            city: geoData.city,
            country: geoData.country_name,
            countryCode: geoData.country_code
          }),
        }).catch(err => console.error("Geo recording failed:", err));
      }

      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`)

    } catch (err) {
      setError("Щось пішло не так. Спробуйте пізніше.")
      setLoading(false)
    }
  }

  const handleGoogleRegister = async () => {
    setGoogleLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError("Помилка Google входу. Спробуйте ще раз.")
      setGoogleLoading(false)
    }
  }

  return (
    <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#C9A84C]/20 rounded-[2.5rem] shadow-2xl p-8">
      <div className="mb-7">
        <h2 className="text-2xl font-serif font-bold text-white">Реєстрація</h2>
        <p className="text-sm text-[#E0E6ED]/60 mt-1">
          Створіть акаунт для доступу до юридичного AI
        </p>
      </div>

      <button
        type="button"
        className="w-full h-12 flex items-center justify-center gap-2.5 mb-5 rounded-2xl border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#E0E6ED] text-sm font-medium transition-all disabled:opacity-50"
        onClick={handleGoogleRegister}
        disabled={googleLoading || loading}
      >
        {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
        Зареєструватись через Google
      </button>

      <div className="relative mb-5">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-[#C9A84C]/10" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-[#0d1120] px-3 text-[#C9A84C]/70 font-black uppercase tracking-[0.2em]">або з email</span>
        </div>
      </div>

      <form onSubmit={handleRegister} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Повне ім&apos;я</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="Іваненко Іван Іванович"
            value={fullName}
            autoComplete="name"
            autoFocus
            onChange={(e) => { setFullName(e.target.value); setError("") }}
            className="h-14 bg-[#0A0E1A] border-[#C9A84C]/20 rounded-2xl text-[#E0E6ED] placeholder:text-[#C9A84C]/20 focus-visible:border-[#C9A84C]/50 focus-visible:ring-0"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={email}
            autoComplete="email"
            onChange={(e) => { setEmail(e.target.value); setError("") }}
            className="h-14 bg-[#0A0E1A] border-[#C9A84C]/20 rounded-2xl text-[#E0E6ED] placeholder:text-[#C9A84C]/20 focus-visible:border-[#C9A84C]/50 focus-visible:ring-0"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Пароль</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Мінімум 6 символів"
              value={password}
              autoComplete="new-password"
              onChange={(e) => { setPassword(e.target.value); setError("") }}
              className="h-14 pr-12 bg-[#0A0E1A] border-[#C9A84C]/20 rounded-2xl text-[#E0E6ED] placeholder:text-[#C9A84C]/20 focus-visible:border-[#C9A84C]/50 focus-visible:ring-0"
              required
            />
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#C9A84C]/50 hover:text-[#C9A84C] transition-colors"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {passwordStrength && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex gap-1 flex-1">
                {["weak", "medium", "strong"].map((level, i) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-colors ${passwordStrength === "weak" && i === 0
                      ? "bg-red-500"
                      : passwordStrength === "medium" && i <= 1
                        ? "bg-amber-500"
                        : passwordStrength === "strong"
                          ? "bg-emerald-500"
                          : "bg-[#C9A84C]/10"
                      }`}
                  />
                ))}
              </div>
              <span className={`text-[12px] font-black uppercase tracking-wider ${passwordStrength === "weak" ? "text-red-400" :
                passwordStrength === "medium" ? "text-amber-400" : "text-emerald-400"
                }`}>
                {passwordStrength === "weak" ? "Слабкий" : passwordStrength === "medium" ? "Середній" : "Надійний"}
              </span>
            </div>
          )}
        </div>

        <Button
          type="submit"
          disabled={loading || googleLoading || !email || !password || !fullName}
          className="w-full h-14 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#C9A84C]/10 transition-all active:scale-95 disabled:opacity-40 mt-2"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Зареєструватись"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-[#E0E6ED]/70 mt-6">
        Вже є акаунт?{" "}
        <Link href="/auth/login" className="text-[#C9A84C] font-semibold hover:text-[#E2C47A] transition-colors underline-offset-4 hover:underline">
          Увійти
        </Link>
      </p>

      <p className="text-center text-[12px] text-white/25 mt-4 leading-relaxed">
        Реєструючись, ви погоджуєтесь із{" "}
        <Link href="/terms" className="text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors underline-offset-2 hover:underline">
          Умовами користування
        </Link>{" "}
        та{" "}
        <Link href="/privacy" className="text-[#C9A84C]/60 hover:text-[#C9A84C] transition-colors underline-offset-2 hover:underline">
          Політикою конфіденційності
        </Link>
      </p>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden p-4">
      <AuthBg />
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 mb-10">
          <Image src="/logo.jpg" alt="URAI" width={72} height={72} className="rounded-2xl object-cover shadow-2xl shadow-[#C9A84C]/20" />
          <div className="text-center">
            <h1 className="text-3xl font-serif font-bold tracking-tight text-[#C9A84C]">URAI</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-0.5">Юридичний асистент на базі AI</p>
          </div>
        </div>

        <Suspense fallback={
          <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#C9A84C]/10 rounded-[2.5rem] p-8 flex items-center justify-center h-[460px]">
            <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" />
          </div>
        }>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  )
}