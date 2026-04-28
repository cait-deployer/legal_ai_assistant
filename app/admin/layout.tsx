"use client"

import type React from "react"
import { useState, useEffect, startTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  LayoutDashboard, Menu, X, LogOut, ChevronLeft,
  Scale, ChevronRight, PanelLeftClose, PanelLeftOpen,
  Settings, BookOpen, CreditCard, Bot, BarChart2, Users, ShieldCheck, Gavel, BookMarked,
  RefreshCw, Database, ChevronDown, LayoutGrid, Building2, HardDriveDownload, Sparkles,
  Download, HardDrive, MessageSquareHeart,
} from "lucide-react"
import { Toaster } from "sonner"

type NavChild = { name: string; href: string; icon: React.ElementType }
type NavItem  = { name: string; href: string; icon: React.ElementType; children?: NavChild[] }

const navigation: NavItem[] = [
  { name: "Огляд",         href: "/admin",          icon: LayoutDashboard },
  { name: "Користувачі",   href: "/admin/users",     icon: Users           },
  { name: "Аналітика",     href: "/admin/analytics", icon: BarChart2       },
  { name: "Тарифи",        href: "/admin/plans",     icon: CreditCard      },
  {
    name: "Синхронізація",
    href: "/admin/sync",
    icon: RefreshCw,
    children: [
      { name: "Зведення",        href: "/admin/sync",     icon: LayoutGrid        },
      { name: "Скрапер",         href: "/admin/scraper",  icon: Download          },
      { name: "Реіндекс",        href: "/admin/reindex",  icon: HardDriveDownload },
      { name: "Аналітика даних", href: "/admin/data",     icon: BarChart2         },
      { name: "Диск",            href: "/admin/disk",     icon: HardDrive         },
      { name: "Джерела",         href: "/admin/sources",  icon: BookOpen          },
      { name: "V2 Панель",       href: "/admin/v2",       icon: Sparkles          },
    ],
  },
  { name: "Покриття бази", href: "/admin/rada/coverage", icon: ShieldCheck        },
  { name: "Відгуки",       href: "/admin/feedback",      icon: MessageSquareHeart },
  { name: "AI Модель",     href: "/admin/ai-settings",   icon: Bot                },
  { name: "Онбординг",     href: "/admin/onboarding",    icon: Scale              },
  { name: "База знань",    href: "/admin/base",          icon: BookOpen           },
]

const SYNC_HREFS = ["/admin/sync", "/admin/scraper", "/admin/reindex", "/admin/data", "/admin/disk", "/admin/sources", "/admin/v2"]
const COLLAPSED_KEY    = "admin_sidebar_collapsed"
const SYNC_OPEN_KEY    = "admin_sync_open"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed,  setCollapsed]  = useState(false)
  const [mounted,    setMounted]    = useState(false)
  const [syncOpen,   setSyncOpen]   = useState(true)

  useEffect(() => {
    const savedCollapsed = localStorage.getItem(COLLAPSED_KEY)
    const savedSync      = localStorage.getItem(SYNC_OPEN_KEY)
    const onSyncPage     = SYNC_HREFS.some(h => pathname === h || pathname.startsWith(h + "/"))
    startTransition(() => {
      setCollapsed(savedCollapsed === "true")
      setSyncOpen(savedSync === null ? onSyncPage : savedSync === "true")
      setMounted(true)
    })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (pathname === "/admin/login") return <>{children}</>

  const toggleCollapse = () => {
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSED_KEY, String(!v))
      return !v
    })
  }

  const toggleSync = () => {
    setSyncOpen((v) => {
      localStorage.setItem(SYNC_OPEN_KEY, String(!v))
      return !v
    })
  }

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" })
    router.push("/admin/login")
  }

  // Is any sync child active?
  const syncActive = SYNC_HREFS.some(h => pathname === h || pathname.startsWith(h + "/"))

  return (
    <>
      <TooltipProvider>
        <div className="min-h-screen bg-[#0A0E1A] flex">
          {mobileOpen && (
            <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
          )}

          {/* Sidebar */}
          <aside className={cn(
            "fixed top-0 left-0 z-50 h-full bg-[#0d1120] border-r border-[#C9A84C]/20 shadow-xl shadow-black/40",
            "transition-all duration-300 ease-in-out flex flex-col",
            "lg:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
            "w-64",
            mounted && collapsed ? "lg:w-[68px]" : "lg:w-64",
          )}>
            {/* Header */}
            <div className={cn(
              "flex items-center border-b border-[#C9A84C]/10 shrink-0 transition-all duration-300",
              mounted && collapsed ? "lg:px-3 lg:py-4 lg:justify-center px-5 py-[18px] justify-between" : "px-5 py-[18px] justify-between",
            )}>
              {mounted && collapsed ? (
                <>
                  <button
                    onClick={toggleCollapse}
                    className="hidden lg:flex items-center justify-center group"
                    title="Розгорнути"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#C9A84C] flex items-center justify-center shadow-md shadow-[#C9A84C]/20 group-hover:bg-[#E2C47A] transition-all duration-200">
                      <Scale className="w-4 h-4 text-[#0A0E1A]" />
                    </div>
                  </button>
                  <div className="flex items-center gap-3 lg:hidden">
                    <div className="w-9 h-9 rounded-xl bg-[#C9A84C] flex items-center justify-center shadow-md shadow-[#C9A84C]/20 shrink-0">
                      <Scale className="w-4 h-4 text-[#0A0E1A]" />
                    </div>
                    <span className="font-serif font-bold text-base whitespace-nowrap text-white">
                      URAI Admin
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 text-[#C9A84C]/60 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5" onClick={() => setMobileOpen(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-9 h-9 rounded-xl bg-[#C9A84C] flex items-center justify-center shadow-md shadow-[#C9A84C]/20 shrink-0">
                      <Scale className="w-4 h-4 text-[#0A0E1A]" />
                    </div>
                    <span className="font-serif font-bold text-base whitespace-nowrap text-white">
                        URAI Admin
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon"
                      className="hidden lg:flex h-8 w-8 text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5"
                      onClick={toggleCollapse}
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 text-[#C9A84C]/60 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5" onClick={() => setMobileOpen(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Nav */}
            <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
              {navigation.map((item) => {
                if (item.children) {
                  // ── Group item (Синхронізація) ──
                  const isCollapsedSidebar = mounted && collapsed

                  if (isCollapsedSidebar) {
                    // Collapsed sidebar: just show icon linking to overview
                    return (
                      <Tooltip key={item.name}>
                        <TooltipTrigger>
                          <div className="hidden lg:block">
                            <Link href={item.href}>
                              <Button
                                variant="ghost"
                                className={cn(
                                  "w-full h-10 font-medium transition-all duration-200 lg:justify-center lg:px-0",
                                  syncActive
                                    ? "bg-[#C9A84C]/10 text-[#C9A84C] hover:bg-[#C9A84C]/15 hover:text-[#C9A84C] border border-[#C9A84C]/20"
                                    : "hover:bg-[#C9A84C]/5 text-[#E0E6ED]/70 hover:text-[#E0E6ED]",
                                )}
                                onClick={() => setMobileOpen(false)}
                              >
                                <item.icon className={cn("shrink-0 lg:w-5 lg:h-5 w-4 h-4", syncActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/70")} />
                              </Button>
                            </Link>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="font-medium bg-[#0d1120] border-[#C9A84C]/20 text-[#E0E6ED]">{item.name}</TooltipContent>
                      </Tooltip>
                    )
                  }

                  // Expanded sidebar: show collapsible group
                  return (
                    <div key={item.name}>
                      {/* Group header button */}
                      <button
                        onClick={toggleSync}
                        className={cn(
                          "w-full h-10 rounded-md px-3 flex items-center gap-3 font-medium text-sm transition-all duration-200",
                          syncActive
                            ? "text-[#C9A84C] hover:bg-[#C9A84C]/10"
                            : "text-[#E0E6ED]/70 hover:text-[#E0E6ED] hover:bg-[#C9A84C]/5",
                        )}
                      >
                        <item.icon className={cn("shrink-0 w-4 h-4", syncActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/70")} />
                        <span className="flex-1 text-left truncate">{item.name}</span>
                        <ChevronDown className={cn(
                          "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                          syncActive ? "text-[#C9A84C]/60" : "text-[#E0E6ED]/40",
                          syncOpen && "rotate-180",
                        )} />
                      </button>

                      {/* Children */}
                      {syncOpen && (
                        <div className="mt-0.5 ml-3 pl-3 border-l border-[#C9A84C]/15 space-y-0.5">
                          {item.children.map((child) => {
                            const isActive = pathname === child.href || (child.href !== "/admin/sync" && pathname.startsWith(child.href))
                            return (
                              <Link key={child.name} href={child.href}>
                                <Button
                                  variant="ghost"
                                  className={cn(
                                    "w-full h-9 text-sm font-normal justify-start gap-2.5 px-2.5 transition-all duration-200",
                                    isActive
                                      ? "bg-[#C9A84C]/10 text-[#C9A84C] hover:bg-[#C9A84C]/15 hover:text-[#C9A84C] border border-[#C9A84C]/20"
                                      : "hover:bg-[#C9A84C]/5 text-[#E0E6ED]/60 hover:text-[#E0E6ED]",
                                  )}
                                  onClick={() => setMobileOpen(false)}
                                >
                                  <child.icon className={cn("shrink-0 w-3.5 h-3.5", isActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/50")} />
                                  <span className="truncate">{child.name}</span>
                                  {isActive && <ChevronRight className="w-3 h-3 ml-auto text-[#C9A84C]/60" />}
                                </Button>
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

                // ── Regular flat item ──
                const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href))
                const btn = (
                  <Link key={item.name} href={item.href}>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full h-10 font-medium transition-all duration-200 group",
                        collapsed ? "lg:justify-center lg:px-0 justify-start gap-3 px-3" : "justify-start gap-3 px-3",
                        isActive
                          ? "bg-[#C9A84C]/10 text-[#C9A84C] hover:bg-[#C9A84C]/15 hover:text-[#C9A84C] border border-[#C9A84C]/20"
                          : "hover:bg-[#C9A84C]/5 text-[#E0E6ED]/70 hover:text-[#E0E6ED]",
                      )}
                      onClick={() => setMobileOpen(false)}
                    >
                      <item.icon className={cn(
                        "shrink-0",
                        collapsed ? "lg:w-5 lg:h-5 w-4 h-4" : "w-4 h-4",
                        isActive ? "text-[#C9A84C]" : "text-[#E0E6ED]/70 group-hover:text-[#E0E6ED]",
                      )} />
                      <span className={cn("truncate", collapsed && "lg:hidden")}>
                        {item.name}
                      </span>
                      {isActive && !collapsed && (
                        <ChevronRight className="w-3 h-3 ml-auto text-[#C9A84C]/60" />
                      )}
                    </Button>
                  </Link>
                )

                if (collapsed) {
                  return (
                    <Tooltip key={item.name}>
                      <TooltipTrigger>
                        <div className="hidden lg:block">{btn}</div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="font-medium bg-[#0d1120] border-[#C9A84C]/20 text-[#E0E6ED]">{item.name}</TooltipContent>
                    </Tooltip>
                  )
                }
                return <div key={item.name}>{btn}</div>
              })}
            </nav>

            {/* Expand button when collapsed */}
            {mounted && collapsed && (
              <div className="hidden lg:flex justify-center py-2 shrink-0">
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="ghost" size="icon"
                      className="h-9 w-9 text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5"
                      onClick={toggleCollapse}
                    >
                      <PanelLeftOpen className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-[#0d1120] border-[#C9A84C]/20 text-[#E0E6ED]">Розгорнути</TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* Footer */}
            <div className={cn(
              "border-t border-[#C9A84C]/10 shrink-0 transition-all duration-300 flex flex-col gap-1.5",
              collapsed ? "p-2" : "p-3",
            )}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger>
                    <Link href="/" className="flex items-center justify-center w-full h-10 rounded-xl text-[#C9A84C]/70 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 transition-colors">
                      <ChevronLeft className="w-4 h-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-[#0d1120] border-[#C9A84C]/20 text-[#E0E6ED]">До чату</TooltipContent>
                </Tooltip>
              ) : (
                <Link href="/">
                  <Button variant="ghost" className="w-full justify-start gap-3 h-10 font-medium text-sm text-[#C9A84C]/60 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 border border-[#C9A84C]/10 hover:border-[#C9A84C]/20 rounded-xl transition-all duration-200">
                    <ChevronLeft className="w-4 h-4" />
                    До чату
                  </Button>
                </Link>
              )}
            </div>
          </aside>

          {/* Main */}
          <div className={cn(
            "flex-1 min-w-0 transition-all duration-300",
            mounted && collapsed ? "lg:pl-[68px]" : "lg:pl-64",
          )}>
            <header className="sticky top-0 z-30 bg-[#0A0E1A]/80 backdrop-blur-md border-b border-[#C9A84C]/10">
              <div className="flex items-center justify-between px-4 sm:px-6 py-3.5">
                <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9 text-[#C9A84C]/60 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5" onClick={() => setMobileOpen(true)}>
                  <Menu className="w-5 h-5" />
                </Button>
                <div className="hidden lg:flex items-center gap-2 text-sm text-[#C9A84C]/60">
                  <Scale className="w-4 h-4" />
                  <span className="text-[#C9A84C]/50">/</span>
                  <span className="text-[#E0E6ED]/80 font-medium">
                    {(() => {
                      // Check sync children first
                      const syncChild = navigation
                        .find(n => n.children)
                        ?.children?.find(c => c.href === pathname || (c.href !== "/admin/sync" && pathname.startsWith(c.href)))
                      if (syncChild) return syncChild.name
                      return navigation.find(n => !n.children && (n.href === pathname || (n.href !== "/admin" && pathname.startsWith(n.href))))?.name ?? "Адмін"
                    })()}
                  </span>
                </div>
                <div className="flex-1 lg:flex-none" />
                <DropdownMenu>
                  <DropdownMenuTrigger className="focus:outline-none">
                    <div className="inline-flex items-center gap-2.5 px-2.5 h-10 hover:bg-[#C9A84C]/5 rounded-xl cursor-pointer transition-colors">
                      <Avatar className="w-8 h-8 border-2 border-[#C9A84C]/20">
                        <AvatarFallback className="bg-[#C9A84C]/10 text-[#C9A84C] text-xs font-bold">AD</AvatarFallback>
                      </Avatar>
                      <span className="hidden md:inline-block font-medium text-sm text-[#E0E6ED]/80">Admin</span>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-[#0d1120] border-[#C9A84C]/20">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-sm text-[#E0E6ED]">Admin</span>
                        <span className="text-xs text-[#C9A84C]/70">Панель керування</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-[#C9A84C]/10" />
                    <DropdownMenuItem
                      className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer"
                      onClick={handleLogout}
                    >
                      <LogOut className="w-4 h-4 mr-2" /> Вийти
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <main className="p-4 xl:px-10 h-[calc(100vh-72px)] overflow-y-auto">
              <div className="w-full mx-auto flex flex-col h-full">{children}</div>
            </main>
          </div>
        </div>
      </TooltipProvider>
      <Toaster />
    </>
  )
}
