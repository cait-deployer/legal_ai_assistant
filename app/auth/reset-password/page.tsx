// // "use client"

// // import { Suspense, useEffect, useState } from "react"
// // import { useRouter } from "next/navigation"
// // import Link from "next/link"
// // import { Button } from "@/components/ui/button"
// // import { Input } from "@/components/ui/input"
// // import { Label } from "@/components/ui/label"
// // import { Eye, EyeOff, Scale, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
// // import { createClient } from "@/lib/supabase/client"

// // function AuthBg() {
// //   return (
// //     <div className="absolute inset-0 pointer-events-none select-none" aria-hidden>
// //       <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/8 blur-[120px]" />
// //       <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-primary/6 blur-[140px]" />
// //       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-muted/30 blur-[100px]" />
// //       <svg className="absolute inset-0 w-full h-full opacity-[0.025]">
// //         <defs>
// //           <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
// //             <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" />
// //           </pattern>
// //         </defs>
// //         <rect width="100%" height="100%" fill="url(#dots)" className="text-foreground" />
// //       </svg>
// //       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full border border-border/30" />
// //       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full border border-border/15" />
// //     </div>
// //   )
// // }

// // function ResetPasswordForm() {
// //   const router = useRouter()
// //   const supabase = createClient()
// //   const [password, setPassword] = useState("")
// //   const [confirmPassword, setConfirmPassword] = useState("")
// //   const [showPassword, setShowPassword] = useState(false)
// //   const [error, setError] = useState("")
// //   const [success, setSuccess] = useState(false)
// //   const [loading, setLoading] = useState(false)
// //   const [sessionReady, setSessionReady] = useState(false)

// //   useEffect(() => {
// //     // Supabase sends the recovery token in the URL hash — SSR cannot read it,
// //     // so we listen for the SIGNED_IN event fired after the redirect.
// //     const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
// //       if (event === "PASSWORD_RECOVERY") {
// //         setSessionReady(true)
// //       }
// //     })
// //     return () => subscription.unsubscribe()
// //   }, [supabase])

// //   const handleSubmit = async (e: React.FormEvent) => {
// //     e.preventDefault()
// //     setError("")

// //     if (password.length < 6) {
// //       setError("Пароль має бути мінімум 6 символів")
// //       return
// //     }
// //     if (password !== confirmPassword) {
// //       setError("Паролі не збігаються")
// //       return
// //     }

// //     setLoading(true)

// //     const { error } = await supabase.auth.updateUser({ password })

// //     if (error) {
// //       setError("Помилка скидання пароля. Посилання могло застаріти.")
// //       setLoading(false)
// //       return
// //     }

// //     setSuccess(true)
// //     setTimeout(() => router.push("/"), 2500)
// //   }

// //   if (success) {
// //     return (
// //       <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl shadow-black/5 p-7 text-center">
// //         <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
// //           <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
// //         </div>
// //         <h3 className="text-base font-semibold text-foreground mb-2">Пароль змінено</h3>
// //         <p className="text-sm text-muted-foreground">
// //           Перенаправлення до чату...
// //         </p>
// //       </div>
// //     )
// //   }

// //   if (!sessionReady) {
// //     return (
// //       <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl p-7 flex flex-col items-center gap-3 text-center">
// //         <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
// //         <p className="text-sm text-muted-foreground">Перевірка посилання...</p>
// //       </div>
// //     )
// //   }

// //   return (
// //     <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl shadow-black/5 p-7">
// //       <div className="mb-6">
// //         <h2 className="text-lg font-semibold text-foreground">Новий пароль</h2>
// //         <p className="text-sm text-muted-foreground mt-0.5">Введіть новий пароль для вашого акаунту</p>
// //       </div>

// //       <form onSubmit={handleSubmit} className="space-y-4">
// //         {error && (
// //           <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
// //             <AlertCircle className="w-4 h-4 shrink-0" />
// //             {error}
// //           </div>
// //         )}

// //         <div className="space-y-1.5">
// //           <Label htmlFor="password" className="text-sm font-medium">Новий пароль</Label>
// //           <div className="relative">
// //             <Input
// //               id="password"
// //               type={showPassword ? "text" : "password"}
// //               placeholder="Мінімум 6 символів"
// //               value={password}
// //               autoComplete="new-password"
// //               autoFocus
// //               onChange={(e) => { setPassword(e.target.value); setError("") }}
// //               className="h-11 pr-11 bg-background/80"
// //               required
// //             />
// //             <Button
// //               type="button"
// //               variant="ghost"
// //               size="icon"
// //               className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
// //               onClick={() => setShowPassword((v) => !v)}
// //               tabIndex={-1}
// //             >
// //               {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
// //             </Button>
// //           </div>
// //         </div>

// //         <div className="space-y-1.5">
// //           <Label htmlFor="confirmPassword" className="text-sm font-medium">Підтвердіть пароль</Label>
// //           <Input
// //             id="confirmPassword"
// //             type={showPassword ? "text" : "password"}
// //             placeholder="Повторіть пароль"
// //             value={confirmPassword}
// //             autoComplete="new-password"
// //             onChange={(e) => { setConfirmPassword(e.target.value); setError("") }}
// //             className={`h-11 bg-background/80 ${
// //               confirmPassword && confirmPassword !== password
// //                 ? "border-destructive/50 focus-visible:ring-destructive/30"
// //                 : ""
// //             }`}
// //             required
// //           />
// //         </div>

// //         <Button
// //           type="submit"
// //           disabled={loading || !password || !confirmPassword}
// //           className="w-full h-11 font-semibold mt-2"
// //         >
// //           {loading ? (
// //             <><Loader2 className="w-4 h-4 animate-spin mr-2" />Збереження...</>
// //           ) : (
// //             "Зберегти пароль"
// //           )}
// //         </Button>
// //       </form>

// //       <p className="text-center text-sm text-muted-foreground mt-5">
// //         <Link href="/auth/login" className="hover:text-foreground transition-colors underline underline-offset-4">
// //           Повернутись до входу
// //         </Link>
// //       </p>
// //     </div>
// //   )
// // }

// // export default function ResetPasswordPage() {
// //   return (
// //     <div className="min-h-screen bg-background relative flex items-center justify-center overflow-hidden">
// //       <AuthBg />
// //       <div className="relative z-10 w-full max-w-[400px] mx-4">
// //         <div className="flex flex-col items-center gap-3 mb-8">
// //           <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25 ring-4 ring-primary/10">
// //             <Scale className="w-7 h-7 text-primary-foreground" />
// //           </div>
// //           <div className="text-center">
// //             <h1 className="text-2xl font-bold tracking-tight text-foreground">Lawyer AI</h1>
// //             <p className="text-sm text-muted-foreground mt-0.5">Юридичний асистент на базі AI</p>
// //           </div>
// //         </div>

// //         <Suspense fallback={
// //           <div className="bg-card/80 backdrop-blur-sm border border-border/60 rounded-2xl shadow-xl p-7 flex items-center justify-center h-[300px]">
// //             <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
// //           </div>
// //         }>
// //           <ResetPasswordForm />
// //         </Suspense>
// //       </div>
// //     </div>
// //   )
// // }
// "use client"

// import { Suspense, useEffect, useState } from "react"
// import { useSearchParams } from "next/navigation"
// import Link from "next/link"
// import { Button } from "@/components/ui/button"
// import { Scale, Loader2, Mail, RefreshCw, CheckCircle2, ArrowLeft, ShieldCheck } from "lucide-react"
// import { createClient } from "@/lib/supabase/client"
// import { motion, AnimatePresence } from "framer-motion"

// function AuthBg() {
//   return (
//     <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden>
//       <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[#BFA071]/5 blur-[120px]" />
//       <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFA071]/3 blur-[140px]" />
//       <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03]" />
//     </div>
//   )
// }

// const RESEND_COOLDOWN = 60

// function VerifyEmailContent() {
//   const searchParams = useSearchParams()
//   const supabase = createClient()

//   const email = searchParams.get("email") ?? ""
//   const [cooldown, setCooldown] = useState(0)
//   const [resendLoading, setResendLoading] = useState(false)
//   const [resendSuccess, setResendSuccess] = useState(false)
//   const [error, setError] = useState("")

//   useEffect(() => {
//     if (cooldown <= 0) return
//     const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
//     return () => clearTimeout(timer)
//   }, [cooldown])

//   const handleResend = async () => {
//     if (!email || cooldown > 0) return
//     setResendLoading(true)
//     setError("")
//     setResendSuccess(false)

//     const { error } = await supabase.auth.resend({
//       type: "signup",
//       email,
//       options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
//     })

//     setResendLoading(false)
//     if (error) {
//       setError("Не вдалося відправити лист. Спробуйте пізніше.")
//       return
//     }

//     setResendSuccess(true)
//     setCooldown(RESEND_COOLDOWN)
//   }

//   return (
//     <motion.div
//       initial={{ opacity: 0, scale: 0.95 }}
//       animate={{ opacity: 1, scale: 1 }}
//       className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] shadow-2xl p-8 relative overflow-hidden"
//     >
//       <div className="absolute top-0 right-0 p-8 opacity-5">
//         <ShieldCheck size={120} className="text-[#BFA071]" />
//       </div>

//       {/* Animated mail icon */}
//       <div className="flex justify-center mb-8">
//         <div className="relative">
//           <div className="w-20 h-20 rounded-3xl bg-[#BFA071]/10 border border-[#BFA071]/20 flex items-center justify-center shadow-inner shadow-black/20">
//             <Mail className="w-10 h-10 text-[#BFA071]" strokeWidth={1.5} />
//           </div>
//           <span className="absolute -top-1 -right-1 flex h-5 w-5">
//             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#BFA071] opacity-40" />
//             <span className="relative inline-flex rounded-full h-5 w-5 bg-[#BFA071] shadow-lg shadow-[#BFA071]/50" />
//           </span>
//         </div>
//       </div>

//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-serif font-bold text-white mb-3">Підтвердіть пошту</h2>
//         <p className="text-sm text-[#E0E6ED]/60 leading-relaxed max-w-[280px] mx-auto">
//           Ми надіслали інструкції на адресу:<br />
//           {email ? (
//             <span className="font-bold text-[#BFA071] break-all">{email}</span>
//           ) : (
//             <span className="italic">вашу адресу</span>
//           )}
//         </p>
//       </div>

//       {/* Steps with premium design */}
//       <div className="space-y-4 mb-8">
//         {[
//           "Перевірте папку Вхідні",
//           "Відкрийте лист від URAI",
//           "Натисніть «Підтвердити»",
//         ].map((step, i) => (
//           <div key={i} className="flex items-center gap-4 group">
//             <div className="w-8 h-8 rounded-xl bg-[#0A0E1A] border border-[#BFA071]/20 text-[#BFA071] flex items-center justify-center shrink-0 font-serif font-bold text-xs group-hover:border-[#BFA071] transition-colors">
//               {i + 1}
//             </div>
//             <span className="text-xs font-medium text-[#E0E6ED]/80 uppercase tracking-widest">{step}</span>
//           </div>
//         ))}
//       </div>

//       <AnimatePresence>
//         {resendSuccess && (
//           <motion.div
//             initial={{ opacity: 0, y: -10 }}
//             animate={{ opacity: 1, y: 0 }}
//             exit={{ opacity: 0 }}
//             className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-6"
//           >
//             <CheckCircle2 className="w-4 h-4 shrink-0" />
//             Лист успішно відправлено!
//           </motion.div>
//         )}

//         {error && (
//           <motion.div
//             initial={{ opacity: 0, y: -10 }}
//             animate={{ opacity: 1, y: 0 }}
//             className="px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider mb-6"
//           >
//             {error}
//           </motion.div>
//         )}
//       </AnimatePresence>

//       {/* Resend button */}
//       <Button
//         onClick={handleResend}
//         disabled={resendLoading || cooldown > 0 || !email}
//         className="w-full h-14 rounded-2xl bg-[#BFA071] hover:bg-[#d4b78a] text-[#0A0E1A] font-black uppercase tracking-[0.15em] text-[11px] shadow-lg shadow-[#BFA071]/10 transition-all active:scale-95 disabled:opacity-40"
//       >
//         {resendLoading ? (
//           <Loader2 className="w-5 h-5 animate-spin" />
//         ) : (
//           <div className="flex items-center gap-2">
//             <RefreshCw className={`w-4 h-4 ${cooldown > 0 ? 'animate-spin-slow' : ''}`} />
//             {cooldown > 0 ? `Зачекайте (${cooldown}с)` : "Надіслати ще раз"}
//           </div>
//         )}
//       </Button>

//       <p className="text-[9px] text-[#BFA071]/70 font-bold uppercase tracking-widest text-center mt-5">
//         Не забудьте перевірити папку «Спам»
//       </p>

//       {/* Footer links */}
//       <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#BFA071]/10">
//         <Link
//           href="/auth/login"
//           className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all flex items-center gap-2"
//         >
//           <ArrowLeft className="w-3 h-3" /> Увійти
//         </Link>
//         <Link
//           href="/auth/register"
//           className="text-[10px] font-black text-[#BFA071]/60 hover:text-[#BFA071] uppercase tracking-[0.2em] transition-all"
//         >
//           Змінити Email
//         </Link>
//       </div>
//     </motion.div>
//   )
// }

// export default function VerifyEmailPage() {
//   return (
//     <div className="min-h-screen bg-[#0A0E1A] relative flex items-center justify-center overflow-hidden p-6">
//       <AuthBg />

//       <div className="relative z-10 w-full max-w-[440px]">
//         {/* Logo header */}
//         <div className="flex flex-col items-center gap-4 mb-10">
//           <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-[#BFA071] to-[#d4b78a] flex items-center justify-center shadow-2xl shadow-[#BFA071]/20 ring-4 ring-[#BFA071]/10">
//             <Scale className="w-8 h-8 text-[#0A0E1A]" />
//           </div>
//           <div className="text-center">
//             <h1 className="text-3xl font-serif font-bold tracking-tight text-white">
//               URAI <span className="text-[#BFA071]">Legal</span>
//             </h1>
//             <div className="h-0.5 w-12 bg-[#BFA071] mx-auto mt-2 rounded-full opacity-40" />
//           </div>
//         </div>

//         <Suspense fallback={
//           <div className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/10 rounded-[2.5rem] p-8 flex flex-col items-center justify-center h-[500px] gap-4">
//             <Loader2 className="w-10 h-10 animate-spin text-[#BFA071]" />
//             <span className="text-[10px] font-black text-[#BFA071] uppercase tracking-widest animate-pulse">Завантаження...</span>
//           </div>
//         }>
//           <VerifyEmailContent />
//         </Suspense>

//         <p className="text-center mt-8 text-[10px] text-[#BFA071]/50 font-bold uppercase tracking-[0.3em]">
//           URAI Intelligence Systems · 2026
//         </p>
//       </div>

//       <style jsx global>{`
//         @keyframes spin-slow {
//           from { transform: rotate(0deg); }
//           to { transform: rotate(360deg); }
//         }
//         .animate-spin-slow {
//           animation: spin-slow 3s linear infinite;
//         }
//       `}</style>
//     </div>
//   )
// }

"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Scale, Loader2, AlertCircle, CheckCircle2, ArrowLeft, ShieldCheck, Lock } from "lucide-react"
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
  const supabase = createClient()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    // Ваша оригінальна логіка сесії
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [supabase])

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
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError("Помилка скидання пароля. Посилання могло застаріти.")
      setLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push("/"), 2500)
  }

  if (success) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#0d1120]/80 backdrop-blur-xl border border-[#BFA071]/20 rounded-[2.5rem] p-10 text-center shadow-2xl">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
        <h3 className="text-2xl font-serif font-bold text-white mb-3">Пароль змінено</h3>
        <p className="text-sm text-[#E0E6ED]/60 leading-relaxed">
          Ваш доступ успішно відновлено.<br />Перенаправлення в систему...
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