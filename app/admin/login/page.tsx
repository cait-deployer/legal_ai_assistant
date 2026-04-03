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
    <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl shadow-black/5 p-7">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Вхід</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Введіть дані для доступу до панелі</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="username" className="text-sm font-medium">Логін</Label>
          <Input
            id="username"
            type="text"
            placeholder="Введіть логін"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(e) => { setUsername(e.target.value); setError("") }}
            className="h-11 bg-background/80"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium">Пароль</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Введіть пароль"
              value={password}
              autoComplete="current-password"
              onChange={(e) => { setPassword(e.target.value); setError("") }}
              className="h-11 pr-11 bg-background/80"
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <Button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full h-11 gap-2 font-semibold mt-2"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Вхід...</>
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
    <div className="min-h-screen bg-background relative flex items-center justify-center overflow-hidden">
      {/* Abstract background */}
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-primary/6 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-muted/30 blur-[100px]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.025]">
          <defs>
            <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" className="text-foreground" />
        </svg>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-border/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-border/15" />
      </div>

      <div className="relative z-10 w-full max-w-[400px] mx-4">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25 ring-4 ring-primary/10">
            <Scale className="w-7 h-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Lawyer AI</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Панель адміністратора</p>
          </div>
        </div>

        <Suspense fallback={
          <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl p-7 flex items-center justify-center h-[280px]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        }>
          <LoginForm />
        </Suspense>

        <p className="text-center text-sm text-muted-foreground mt-5">
          <a href="/" className="hover:text-foreground transition-colors inline-flex items-center gap-1.5 underline underline-offset-4">
            ← Назад до чату
          </a>
        </p>
      </div>
    </div>
  )
}
