"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Users, Search, X, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Loader2,
  Check, Mail, Globe, MessageSquare, ArrowLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// ── Types ─────────────────────────────────────────────────────────────────────

type User = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  subscription_tier: string
  is_onboarded: boolean
  email_confirmed: boolean
  trial_used: boolean
  last_active_at: string | null
  last_city: string | null
  last_country: string | null
  last_country_code: string | null
  auth_provider: string
  requests_this_month: number
  monthly_limit: number | null
  total_requests: number
  session_count: number
  avg_session_duration: number
  created_at: string
  last_ip: string | null
  user_agent: string | null
  marketing_consent: boolean
  limit_reset_at: string | null
}

type Stats = {
  total: number
  active_7d: number
  not_onboarded: number
  trial_used: number
  by_tier: Record<string, number>
}

type SortState = { col: string; dir: "asc" | "desc" }

type Filters = {
  tier: string
  onboarded: string
  confirmed: string
  activity: string
  provider: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_CFG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  free:     { label: "Free",     bg: "bg-[#C9A84C]/5",   text: "text-[#C9A84C]/70",  border: "border-[#C9A84C]/20" },
  daily:    { label: "Daily",    bg: "bg-blue-500/10",   text: "text-blue-400",       border: "border-blue-500/20"  },
  standard: { label: "Standard", bg: "bg-amber-500/10",  text: "text-amber-400",      border: "border-amber-500/20" },
  pro:      { label: "Pro",      bg: "bg-purple-500/10", text: "text-purple-400",     border: "border-purple-500/20"},
}

const SORTABLE: Record<string, string> = {
  subscription_tier:   "Тариф",
  requests_this_month: "Запити",
  last_active_at:      "Активність",
  created_at:          "Зареєстрований",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryFlag(code: string | null) {
  if (!code || code.length !== 2) return ""
  return code.toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  )
}

function formatRelative(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: "Ніколи", cls: "text-[#E0E6ED]/25" }
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  const h = Math.floor(mins / 60)
  const d = Math.floor(h / 24)
  if (mins < 2)   return { text: "Щойно",        cls: "text-emerald-400" }
  if (mins < 60)  return { text: `${mins} хв тому`, cls: "text-emerald-400" }
  if (h < 24)     return { text: `${h} год тому`,   cls: "text-emerald-400" }
  if (d < 7)      return { text: `${d} дн тому`,    cls: "text-amber-400"   }
  if (d < 30)     return { text: `${d} дн тому`,    cls: "text-[#E0E6ED]/50"}
  return             { text: `${d} дн тому`,    cls: "text-red-400/70"  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
  })
}

function parseBrowser(ua: string | null) {
  if (!ua) return "—"
  const os = ua.includes("Windows") ? "Windows"
           : ua.includes("Mac")     ? "macOS"
           : ua.includes("Linux")   ? "Linux"
           : ua.includes("Android") ? "Android"
           : ua.includes("iPhone")  ? "iOS" : "?"
  const m = ua.match(/(?:Chrome|Firefox|Safari|Edge|OPR)\/([\d]+)/)
  const browser = m ? ua.match(/(Chrome|Firefox|Safari|Edge|OPR)/)?.[0] ?? "?" : "?"
  const ver = m?.[1] ?? ""
  return `${browser} ${ver} / ${os}`
}

function initials(u: User) {
  return ((u.full_name?.[0] ?? u.email[0]) || "?").toUpperCase()
}

// ── Small components ──────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: string }) {
  const c = TIER_CFG[tier] ?? TIER_CFG.free
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  )
}

function SortTh({
  col, label, sort, onSort, className = "",
}: {
  col: string; label: string; sort: SortState; onSort: (col: string) => void; className?: string
}) {
  const active = sort.col === col
  return (
    <th
      className={`px-4 py-3 text-left text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider cursor-pointer select-none hover:text-[#C9A84C] transition-colors group ${className}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sort.dir === "asc"
            ? <ArrowUp   className="w-3 h-3 text-[#C9A84C]" />
            : <ArrowDown className="w-3 h-3 text-[#C9A84C]" />
          : <ArrowUpDown className="w-3 h-3 opacity-25 group-hover:opacity-60" />
        }
      </span>
    </th>
  )
}

function Th({ label, className = "" }: { label: string; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-[10px] font-black text-[#C9A84C]/70 uppercase tracking-wider ${className}`}>
      {label}
    </th>
  )
}

function StatCard({ label, value, sub, accent = false }: {
  label: string; value: string | number; sub?: string; accent?: boolean
}) {
  return (
    <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-4 min-w-0">
      <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-2 truncate">{label}</p>
      <p className={`text-2xl font-serif font-bold ${accent ? "text-emerald-400" : "text-[#C9A84C]"}`}>{value}</p>
      {sub && <p className="text-[11px] text-[#E0E6ED]/35 mt-1 truncate">{sub}</p>}
    </div>
  )
}

function FilterSelect({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-3 bg-[#0d1120] border border-[#C9A84C]/20 rounded-xl text-[11px] text-[#E0E6ED]/70 focus:outline-none focus:border-[#C9A84C]/40 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#0d1120]">
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── User Drawer ───────────────────────────────────────────────────────────────

function DrawerRow({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-[#C9A84C]/5 last:border-0">
      <span className="text-xs text-[#E0E6ED]/40 shrink-0">{label}</span>
      <span className={`text-xs text-right ${mono ? "font-mono text-[#E0E6ED]/60" : "font-medium text-[#E0E6ED]/80"} truncate`}>
        {value ?? "—"}
      </span>
    </div>
  )
}

function BoolRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-[#C9A84C]/5 last:border-0">
      <span className="text-xs text-[#E0E6ED]/40 shrink-0">{label}</span>
      {value
        ? <Check className="w-4 h-4 text-emerald-400 shrink-0" />
        : <X     className="w-4 h-4 text-[#E0E6ED]/20 shrink-0" />}
    </div>
  )
}

type ChatRow = { id: string; title: string | null; created_at: string; updated_at: string }
type MsgRow  = { id: string; role: string; content: string; created_at: string }

function UserDrawer({ user, onClose }: { user: User; onClose: () => void }) {
  const rel = formatRelative(user.last_active_at)
  const pct = user.monthly_limit ? Math.min(100, Math.round((user.requests_this_month / user.monthly_limit) * 100)) : 0
  const [chats, setChats]               = useState<ChatRow[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [openChat, setOpenChat]         = useState<ChatRow | null>(null)
  const [messages, setMessages]         = useState<MsgRow[]>([])
  const [msgsLoading, setMsgsLoading]   = useState(false)
  const msgsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setChatsLoading(true)
    fetch(`/api/admin/users/${user.id}/chats`)
      .then(r => r.json())
      .then(d => setChats(Array.isArray(d) ? d : []))
      .catch(() => setChats([]))
      .finally(() => setChatsLoading(false))
  }, [user.id])

  const openChatView = (chat: ChatRow) => {
    setOpenChat(chat)
    setMessages([])
    setMsgsLoading(true)
    fetch(`/api/admin/chats/${chat.id}/messages`)
      .then(r => r.json())
      .then(d => setMessages(Array.isArray(d) ? d : []))
      .catch(() => setMessages([]))
      .finally(() => setMsgsLoading(false))
  }

  useEffect(() => {
    if (!msgsLoading) msgsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, msgsLoading])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[420px] bg-[#0d1120] border-l border-[#C9A84C]/20 h-full shadow-2xl flex flex-col overflow-hidden">

        {/* ── Chat conversation panel (slides in from right) ── */}
        <AnimatePresence>
          {openChat && (
            <motion.div
              key="chat-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-0 z-20 bg-[#0d1120] flex flex-col"
            >
              {/* Chat panel header */}
              <div className="shrink-0 bg-[#0d1120]/95 backdrop-blur-sm border-b border-[#C9A84C]/10 px-4 py-3 flex items-center gap-3">
                <button
                  onClick={() => setOpenChat(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-[#C9A84C]/50 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-all shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#E0E6ED] truncate">
                    {openChat.title || "Новий чат"}
                  </p>
                  <p className="text-[10px] text-[#6B7CA3]">
                    {new Date(openChat.updated_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button onClick={onClose} className="text-[#C9A84C]/30 hover:text-[#C9A84C] transition-colors shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {msgsLoading ? (
                  <div className="flex items-center justify-center h-full gap-2 text-sm text-[#6B7CA3]">
                    <Loader2 className="w-4 h-4 animate-spin" /> Завантаження…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-sm text-[#6B7CA3]">
                    Повідомлень немає
                  </div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                          msg.role === "user"
                            ? "bg-[#C9A84C]/15 border border-[#C9A84C]/25 text-[#E0E6ED]/90 rounded-tr-sm"
                            : "bg-[#0A0E1A] border border-[#C9A84C]/10 text-[#E0E6ED]/75 rounded-tl-sm"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                <div ref={msgsEndRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="sticky top-0 bg-[#0d1120]/95 backdrop-blur-sm border-b border-[#C9A84C]/10 px-6 py-4 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center text-[#C9A84C] font-bold text-sm shrink-0">
              {initials(user)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-[#E0E6ED] text-sm truncate">{user.full_name || user.email}</p>
              {user.full_name && <p className="text-xs text-[#E0E6ED]/40 truncate">{user.email}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-[#C9A84C]/40 hover:text-[#C9A84C] transition-colors ml-3 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 flex-1 overflow-y-auto">
          {/* Tier + provider */}
          <div className="flex items-center gap-2 flex-wrap">
            <TierBadge tier={user.subscription_tier} />
            <span className="inline-flex items-center gap-1 text-[10px] text-[#E0E6ED]/40 border border-[#C9A84C]/10 rounded-lg px-2 py-0.5">
              {user.auth_provider === "google" ? <Globe className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
              {user.auth_provider}
            </span>
          </div>

          {/* Activity */}
          <section>
            <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-3">Активність</p>
            <div>
              {/* Requests progress */}
              <div className="mb-3 p-3 bg-[#C9A84C]/5 border border-[#C9A84C]/10 rounded-xl">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[#E0E6ED]/60">Запити цього місяця</span>
                  <span className="text-xs font-mono text-[#C9A84C]">
                    {user.requests_this_month} / {user.monthly_limit ?? "∞"}
                  </span>
                </div>
                {user.monthly_limit && (
                  <div className="w-full h-1.5 bg-[#0A0E1A] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#C9A84C] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {user.limit_reset_at && (
                  <p className="text-[10px] text-[#E0E6ED]/30 mt-1.5">
                    Скинеться {formatDate(user.limit_reset_at)}
                  </p>
                )}
              </div>
              <DrawerRow label="Всього запитів" value={user.total_requests} />
              <DrawerRow label="Сесій" value={user.session_count} />
              <DrawerRow label="Сер. тривалість" value={user.avg_session_duration ? `${user.avg_session_duration} хв` : "—"} />
              <DrawerRow
                label="Остання активність"
                value={<span className={`font-medium ${rel.cls}`}>{rel.text}</span>}
              />
            </div>
          </section>

          {/* Profile */}
          <section>
            <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-3">Профіль</p>
            <BoolRow label="Онбординг пройдено"   value={user.is_onboarded}      />
            <BoolRow label="Email підтверджено"    value={user.email_confirmed}   />
            <BoolRow label="Тріал використано"     value={user.trial_used}        />
            <BoolRow label="Маркетинг погоджено"   value={user.marketing_consent} />
            <DrawerRow label="Зареєстрований" value={formatDate(user.created_at)} />
          </section>

          {/* Technical */}
          <section>
            <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em] mb-3">Технічне</p>
            <DrawerRow label="IP" value={user.last_ip} mono />
            <DrawerRow
              label="Місто"
              value={user.last_city
                ? `${countryFlag(user.last_country_code)} ${user.last_city}${user.last_country ? `, ${user.last_country}` : ""}`
                : "—"}
            />
            <DrawerRow label="Браузер" value={parseBrowser(user.user_agent)} />
          </section>

          {/* Chats */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[10px] font-black text-[#C9A84C]/50 uppercase tracking-[0.2em]">Чати</p>
              {!chatsLoading && (
                <span className="text-[10px] text-[#6B7CA3] bg-[#C9A84C]/5 border border-[#C9A84C]/10 rounded-full px-1.5 py-0.5">
                  {chats.length}
                </span>
              )}
            </div>
            {chatsLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#6B7CA3] py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Завантаження…
              </div>
            ) : chats.length === 0 ? (
              <p className="text-xs text-[#6B7CA3] py-2">Чатів немає</p>
            ) : (
              <div className="space-y-1.5">
                {chats.map(chat => (
                  <button
                    key={chat.id}
                    onClick={() => openChatView(chat)}
                    className="w-full flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#C9A84C]/5 border border-[#C9A84C]/10 hover:bg-[#C9A84C]/10 hover:border-[#C9A84C]/25 transition-all text-left group"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#C9A84C]/40 group-hover:text-[#C9A84C]/70 shrink-0 mt-0.5 transition-colors" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[#E0E6ED]/80 truncate group-hover:text-[#E0E6ED] transition-colors">{chat.title || "Новий чат"}</p>
                      <p className="text-[10px] text-[#6B7CA3]">
                        {new Date(chat.updated_at).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-[#C9A84C]/20 group-hover:text-[#C9A84C]/50 shrink-0 mt-0.5 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers]           = useState<User[]>([])
  const [total, setTotal]           = useState(0)
  const [stats, setStats]           = useState<Stats | null>(null)
  const [loading, setLoading]       = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [rawSearch, setRawSearch]   = useState("")
  const [debouncedSearch, setDebounced] = useState("")
  const [filters, setFilters]       = useState<Filters>({ tier: "", onboarded: "", confirmed: "", activity: "", provider: "" })
  const [sort, setSort]             = useState<SortState>({ col: "created_at", dir: "desc" })
  const [page, setPage]             = useState(1)
  const [selected, setSelected]     = useState<User | null>(null)
  const PER_PAGE = 25
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setDebounced(rawSearch); setPage(1) }, 400)
    return () => clearTimeout(searchTimer.current)
  }, [rawSearch])

  // Fetch stats (once)
  useEffect(() => {
    fetch("/api/admin/users/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  // Fetch users on filter / sort / page change
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({
      search:   debouncedSearch,
      tier:     filters.tier,
      onboarded: filters.onboarded,
      confirmed: filters.confirmed,
      activity:  filters.activity,
      provider:  filters.provider,
      sort_by:   sort.col,
      sort_dir:  sort.dir,
      page:      String(page),
      per_page:  String(PER_PAGE),
    })
    try {
      const r = await fetch(`/api/admin/users?${p}`)
      const d = await r.json()
      setUsers(d.users ?? [])
      setTotal(d.total ?? 0)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [debouncedSearch, filters, sort, page])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSort = (col: string) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: "desc" }
    )
    setPage(1)
  }

  const setFilter = (key: keyof Filters, val: string) => {
    setFilters((f) => ({ ...f, [key]: val }))
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const tierItems  = ["", "free", "daily", "standard", "pro"]

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#C9A84C]/10 shrink-0">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-2xl shrink-0">
            <Users className="w-8 h-8 text-[#C9A84C]" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Користувачі</h1>
            <p className="text-sm text-[#E0E6ED]/70 mt-1">Повний список зареєстрованих користувачів</p>
          </div>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => { fetchUsers(); setStatsLoading(true); fetch("/api/admin/users/stats").then(r => r.json()).then(d => setStats(d)).finally(() => setStatsLoading(false)) }}
          disabled={loading}
          className="gap-2 border border-[#C9A84C]/20 hover:border-[#C9A84C]/40 hover:bg-[#C9A84C]/5 text-[#C9A84C]/60 hover:text-[#C9A84C] rounded-xl shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Оновити
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-6">

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {statsLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl p-4 h-24 animate-pulse" />
            ))
          ) : stats ? (
            <>
              <StatCard label="Всього юзерів"    value={stats.total}         />
              <StatCard label="Активних (7 днів)" value={stats.active_7d}    accent sub={`${stats.total ? Math.round((stats.active_7d / stats.total) * 100) : 0}% від усіх`} />
              <StatCard label="Без онбордингу"    value={stats.not_onboarded} />
              <StatCard label="Тріал використали" value={stats.trial_used}   />
              <StatCard
                label="По тарифах"
                value={`${stats.by_tier.standard ?? 0} / ${stats.by_tier.pro ?? 0}`}
                sub={`Std / Pro · Free: ${stats.by_tier.free ?? 0}`}
              />
            </>
          ) : null}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9A84C]/40 pointer-events-none" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Пошук за email або ім'ям..."
              className="pl-9 pr-8 h-9 w-[240px] bg-[#0d1120] border border-[#C9A84C]/20 rounded-xl text-sm text-[#E0E6ED]/80 placeholder:text-[#E0E6ED]/25 focus:outline-none focus:border-[#C9A84C]/40"
            />
            {rawSearch && (
              <button onClick={() => setRawSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-[#C9A84C]/40 hover:text-[#C9A84C]" />
              </button>
            )}
          </div>

          {/* Tier pills */}
          <div className="flex items-center gap-0.5 p-1 bg-[#0d1120] border border-[#C9A84C]/10 rounded-xl">
            {tierItems.map((t) => (
              <button
                key={t}
                onClick={() => setFilter("tier", t)}
                className={`px-3 h-7 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                  filters.tier === t
                    ? "bg-[#C9A84C] text-[#0A0E1A]"
                    : "text-[#E0E6ED]/50 hover:text-[#E0E6ED]"
                }`}
              >
                {t || "Всі"}
              </button>
            ))}
          </div>

          <FilterSelect
            value={filters.onboarded}
            onChange={(v) => setFilter("onboarded", v)}
            options={[
              { value: "",      label: "Онбординг: всі" },
              { value: "true",  label: "✓ Пройшли" },
              { value: "false", label: "✗ Не пройшли" },
            ]}
          />

          <FilterSelect
            value={filters.activity}
            onChange={(v) => setFilter("activity", v)}
            options={[
              { value: "",         label: "Активність: вся"  },
              { value: "today",    label: "Сьогодні"         },
              { value: "7d",       label: "За 7 днів"        },
              { value: "30d",      label: "За 30 днів"       },
              { value: "inactive", label: "Неактивні (>30д)" },
            ]}
          />

          <FilterSelect
            value={filters.confirmed}
            onChange={(v) => setFilter("confirmed", v)}
            options={[
              { value: "",      label: "Email: всі"          },
              { value: "true",  label: "✓ Підтверджений"     },
              { value: "false", label: "✗ Не підтверджений"  },
            ]}
          />

          <FilterSelect
            value={filters.provider}
            onChange={(v) => setFilter("provider", v)}
            options={[
              { value: "",       label: "Провайдер: всі" },
              { value: "email",  label: "📧 Email"       },
              { value: "google", label: "G Google"       },
            ]}
          />
        </div>

        {/* Table */}
        <div className="bg-[#0d1120]/60 border border-[#C9A84C]/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#C9A84C]/10">
            <p className="text-sm text-[#E0E6ED]/60">
              {loading ? "Завантаження..." : `${total} ${total === 1 ? "юзер" : total < 5 ? "юзери" : "юзерів"}`}
            </p>
            <p className="text-[10px] font-black text-[#C9A84C]/40 uppercase tracking-widest">
              Сторінка {page} з {totalPages}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#C9A84C]/10 bg-[#0A0E1A]/40">
                  <Th label="Юзер" />
                  <SortTh col="subscription_tier"   label="Тариф"       sort={sort} onSort={handleSort} />
                  <SortTh col="requests_this_month" label="Запити"      sort={sort} onSort={handleSort} className="hidden md:table-cell" />
                  <SortTh col="last_active_at"      label="Активність"  sort={sort} onSort={handleSort} />
                  <SortTh col="created_at"          label="Реєстрація"  sort={sort} onSort={handleSort} className="hidden sm:table-cell" />
                  <Th label="Місто"   className="hidden lg:table-cell" />
                  <Th label="Статус"  className="hidden sm:table-cell" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[#C9A84C]/5">
                      {[120, 80, 80, 100, 90, 100, 70].map((w, j) => (
                        <td key={j} className={`px-4 py-3.5 ${j === 2 ? "hidden md:table-cell" : j >= 4 ? "hidden sm:table-cell" : ""}`}>
                          <div className={`h-4 rounded bg-[#C9A84C]/5 animate-pulse`} style={{ width: w }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-[#E0E6ED]/30">
                      Юзерів не знайдено
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const rel = formatRelative(u.last_active_at)
                    return (
                      <tr
                        key={u.id}
                        onClick={() => setSelected(u)}
                        className="border-b border-[#C9A84C]/5 last:border-0 hover:bg-[#C9A84C]/3 transition-colors cursor-pointer"
                      >
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-[#C9A84C]/10 border border-[#C9A84C]/15 flex items-center justify-center text-[#C9A84C] text-xs font-bold shrink-0">
                              {initials(u)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-[#E0E6ED]/90 font-medium truncate max-w-[180px]">
                                {u.full_name || u.email}
                              </p>
                              {u.full_name && (
                                <p className="text-xs text-[#E0E6ED]/40 truncate max-w-[180px]">{u.email}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Tier */}
                        <td className="px-4 py-3">
                          <TierBadge tier={u.subscription_tier} />
                        </td>

                        {/* Requests */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div>
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-xs text-[#E0E6ED]/80 tabular-nums font-medium">
                                {u.requests_this_month}
                              </span>
                              <span className="text-[10px] text-[#E0E6ED]/30">
                                /{u.monthly_limit ?? "∞"}
                              </span>
                            </div>
                            {u.monthly_limit ? (
                              <div className="w-14 h-1 bg-[#C9A84C]/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#C9A84C]/60"
                                  style={{ width: `${Math.min(100, (u.requests_this_month / u.monthly_limit) * 100)}%` }}
                                />
                              </div>
                            ) : null}
                          </div>
                        </td>

                        {/* Activity */}
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${rel.cls}`}>{rel.text}</span>
                        </td>

                        {/* Registration */}
                        <td className="px-4 py-3 text-xs text-[#E0E6ED]/50 hidden sm:table-cell tabular-nums">
                          {formatDate(u.created_at)}
                        </td>

                        {/* City */}
                        <td className="px-4 py-3 text-xs text-[#E0E6ED]/50 hidden lg:table-cell">
                          {u.last_city
                            ? `${countryFlag(u.last_country_code)} ${u.last_city}`
                            : <span className="text-[#E0E6ED]/20">—</span>}
                        </td>

                        {/* Status dots */}
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="flex items-center gap-1.5">
                            <span title="Онбординг" className={`w-2 h-2 rounded-full ${u.is_onboarded ? "bg-emerald-400" : "bg-[#C9A84C]/15"}`} />
                            <span title="Email підтверджено" className={`w-2 h-2 rounded-full ${u.email_confirmed ? "bg-emerald-400" : "bg-[#C9A84C]/15"}`} />
                            <span title="Тріал використано" className={`w-2 h-2 rounded-full ${u.trial_used ? "bg-amber-400" : "bg-[#C9A84C]/15"}`} />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-[#C9A84C]/10">
            <Button
              variant="ghost" size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="gap-1.5 h-9 rounded-xl border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 text-[#E0E6ED]/60 hover:text-[#E0E6ED] disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" /> Попередня
            </Button>

            <div className="flex items-center gap-2">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p: number
                if (totalPages <= 5) {
                  p = i + 1
                } else if (page <= 3) {
                  p = i + 1
                } else if (page >= totalPages - 2) {
                  p = totalPages - 4 + i
                } else {
                  p = page - 2 + i
                }
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                      p === page
                        ? "bg-[#C9A84C] text-[#0A0E1A]"
                        : "text-[#E0E6ED]/40 hover:text-[#E0E6ED] hover:bg-[#C9A84C]/10"
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
            </div>

            <Button
              variant="ghost" size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="gap-1.5 h-9 rounded-xl border border-[#C9A84C]/15 hover:border-[#C9A84C]/30 text-[#E0E6ED]/60 hover:text-[#E0E6ED] disabled:opacity-30"
            >
              Наступна <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] text-[#E0E6ED]/30">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Виконано
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Тріал
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#C9A84C]/20 inline-block" /> Не виконано
          </span>
          <span className="text-[#E0E6ED]/20">· Кольорові точки: онбординг / email / тріал</span>
        </div>
      </div>

      {/* Drawer */}
      {selected && <UserDrawer user={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
