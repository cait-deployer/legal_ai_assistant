"use client"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Scale, Loader2, AlertCircle } from "lucide-react"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })

    if (res.ok) {
      const from = searchParams.get("from") ?? "/admin"
      router.push(from)
    } else {
      setError("Невірний логін або пароль")
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#C9A84C]/20 rounded-[2.5rem] shadow-2xl p-8">
      <div className="mb-7">
        <h2 className="text-2xl font-serif font-bold text-white">Вхід</h2>
        <p className="text-sm text-[#E0E6ED]/60 mt-1">Введіть дані для доступу до панелі</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="username" className="text-[12px] font-black text-[#C9A84C]/60 uppercase tracking-[0.2em]">Логін</Label>
          <Input
            id="username"
            type="text"
            placeholder="Введіть логін"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(e) => { setUsername(e.target.value); setError("") }}
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
              placeholder="Введіть пароль"
              value={password}
              autoComplete="current-password"
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
        </div>

        <Button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full h-14 rounded-2xl bg-[#C9A84C] hover:bg-[#E2C47A] text-[#0A0E1A] font-black uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#C9A84C]/10 transition-all active:scale-95 disabled:opacity-40 mt-2"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Увійти"
          )}
        </Button>
      </form>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden p-4">
      {/* Background */}
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

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 mb-10">
          <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#C9A84C] to-[#E2C47A] flex items-center justify-center shadow-2xl shadow-[#C9A84C]/20 ring-4 ring-[#C9A84C]/10">
            <Scale className="w-8 h-8 text-[#0A0E1A]" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-serif font-bold tracking-tight text-white">
              Lawyer <span className="text-[#C9A84C]">AI</span>
            </h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-0.5">Панель адміністратора</p>
          </div>
        </div>

        <Suspense fallback={
          <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#C9A84C]/10 rounded-[2.5rem] p-8 flex items-center justify-center h-[280px]">
            <Loader2 className="w-8 h-8 animate-spin text-[#C9A84C]" />
          </div>
        }>
          <LoginForm />
        </Suspense>

        <p className="text-center mt-6">
          <a href="/chat" className="text-[12px] font-black text-[#C9A84C]/70 hover:text-[#C9A84C] uppercase tracking-[0.2em] transition-colors inline-flex items-center gap-1.5">
            ← Назад до чату
          </a>
        </p>
      </div>
    </div>
  )
}
