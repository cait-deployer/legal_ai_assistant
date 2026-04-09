"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { Menu, X, LogIn, User, LogOut, Settings } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User as SupabaseUser } from "@supabase/supabase-js"

export function Header() {
  const [isOpen, setIsOpen] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null)
      setUserLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
    setUserMenuOpen(false)
  }

  const displayName = user?.user_metadata?.full_name?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? "Користувач"

  const initials = (user?.user_metadata?.full_name ?? user?.email ?? "U")
    .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()

  const navLinks = [
    { href: "/#features", label: "Можливості" },
    { href: "/#pricing", label: "Тарифи" },
    { href: "/#faq", label: "FAQ" },
    { href: "/terms", label: "Умови користування" },
    { href: "/privacy", label: "Конфіденційність" },
  ]

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#C9A84C]/25 bg-[#0A0E1A]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.jpg"
              alt="URAI logo"
              width={36}
              height={36}
              className="rounded-lg object-cover"
            />
            <span className="font-serif text-xl font-bold text-[#C9A84C]">URAI</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-white/45 hover:text-[#C9A84C] transition-colors duration-200"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side: user state */}
          <div className="hidden md:flex items-center gap-3">
            {userLoading ? (
              <div className="w-9 h-9 rounded-lg bg-[#C9A84C]/10 animate-pulse" />
            ) : user ? (
              /* Logged in — avatar + dropdown */
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#C9A84C]/25 hover:border-[#C9A84C]/50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-md bg-[#C9A84C] flex items-center justify-center text-[#0A0E1A] text-xs font-bold">
                    {initials}
                  </div>
                  <span className="text-sm text-[#E0E6ED] font-medium max-w-[100px] truncate">{displayName}</span>
                </button>

                {userMenuOpen && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                    {/* Dropdown */}
                    <div className="absolute right-0 top-full mt-2 w-48 bg-[#0d1120] border border-[#C9A84C]/25 rounded-xl shadow-2xl overflow-hidden z-20">
                      <div className="px-4 py-3 border-b border-[#C9A84C]/15">
                        <p className="text-xs text-white/45 truncate">{user.email}</p>
                      </div>
                      <Link
                        href="/chat"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#E0E6ED] hover:bg-[#C9A84C]/10 transition-colors"
                      >
                        <User size={14} className="text-[#C9A84C]" />
                        Відкрити чат
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#E0E6ED] hover:bg-[#C9A84C]/10 transition-colors"
                      >
                        <Settings size={14} className="text-[#C9A84C]" />
                        Налаштування
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-[#C9A84C]/15"
                      >
                        <LogOut size={14} />
                        Вийти
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Not logged in — login + CTA */
              <>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-[#E0E6ED] border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 transition-colors"
                >
                  <LogIn size={15} />
                  Увійти
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex items-center gap-1 px-5 py-2.5 rounded-lg text-sm font-bold bg-[#C9A84C] text-[#0A0E1A] hover:bg-[#E2C47A] transition-colors duration-200"
                >
                  Почати безкоштовно →
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden text-white/45 hover:text-[#C9A84C] transition-colors"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Відкрити меню"
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-t border-[#C9A84C]/25 bg-[#0A0E1A]">
          <nav className="flex flex-col px-4 py-4 gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-white/45 hover:text-[#C9A84C] transition-colors"
              >
                {link.label}
              </Link>
            ))}

            {!userLoading && user ? (
              <>
                <div className="flex items-center gap-2 pt-2 border-t border-[#C9A84C]/15">
                  <div className="w-7 h-7 rounded-md bg-[#C9A84C] flex items-center justify-center text-[#0A0E1A] text-xs font-bold shrink-0">
                    {initials}
                  </div>
                  <span className="text-sm text-[#E0E6ED] truncate">{displayName}</span>
                </div>
                <Link href="/chat" onClick={() => setIsOpen(false)} className="text-white/45 hover:text-[#C9A84C] transition-colors text-sm">
                  Відкрити чат
                </Link>
                <Link href="/settings" onClick={() => setIsOpen(false)} className="text-white/45 hover:text-[#C9A84C] transition-colors text-sm">
                  Налаштування
                </Link>
                <button onClick={handleLogout} className="text-left text-red-400 text-sm">
                  Вийти
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex items-center gap-1.5 text-white/60 text-sm"
                >
                  <LogIn size={14} /> Увійти
                </Link>
                <Link
                  href="/chat"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex items-center justify-center gap-1 px-5 py-2.5 rounded-lg text-sm font-bold bg-[#C9A84C] text-[#0A0E1A] hover:bg-[#E2C47A] transition-colors"
                >
                  Почати безкоштовно →
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
