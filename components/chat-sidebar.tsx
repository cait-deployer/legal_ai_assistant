"use client"

import { useEffect, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Plus, Settings, LogOut, MessageSquare, Trash2,
  ChevronRight, Scale, Loader2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type Chat = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

type Profile = {
  full_name: string | null
  email: string
  subscription_tier: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function groupByDate(chats: Chat[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const month = new Date(today); month.setDate(month.getDate() - 30)

  const groups: { label: string; items: Chat[] }[] = [
    { label: "Сьогодні", items: [] },
    { label: "Вчора", items: [] },
    { label: "Попередні 30 д", items: [] },
    { label: "Раніше", items: [] },
  ]

  for (const chat of chats) {
    const d = new Date(chat.updated_at); d.setHours(0, 0, 0, 0)
    if (d >= today) groups[0].items.push(chat)
    else if (d >= yesterday) groups[1].items.push(chat)
    else if (d >= month) groups[2].items.push(chat)
    else groups[3].items.push(chat)
  }

  return groups.filter(g => g.items.length > 0)
}

type Props = {
  currentChatId: string | null
  onNewChat: () => void
  onSelectChat: (id: string) => void
  navigateOnSelect?: boolean
}

export function ChatSidebar({ currentChatId, onNewChat, onSelectChat, navigateOnSelect }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const { data: chats = [], isLoading: chatsLoading } = useSWR<Chat[]>("/api/chats", fetcher, {
    refreshInterval: 30_000,
  })
  const { data: profile } = useSWR<Profile>("/api/settings/profile", fetcher)

  const [deleting, setDeleting] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation()
    setDeleting(chatId)
    await fetch(`/api/chats/${chatId}`, { method: "DELETE" })
    mutate("/api/chats")
    setDeleting(null)
    if (currentChatId === chatId) onNewChat()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    document.cookie = "_ob=; path=/; max-age=0"
    router.push("/auth/login")
  }

  const groups = groupByDate(chats)
  const displayName = profile?.full_name?.split(" ")[0] ?? profile?.email?.split("@")[0] ?? "Користувач"
  const initials = (profile?.full_name ?? profile?.email ?? "U")
    .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()

  return (
    <aside className="w-[270px] shrink-0 h-screen flex flex-col bg-[#0d1120] text-[#E0E6ED] border-r border-[#BFA071]/20 select-none z-40">
      {/* Logo Section */}
      <div className="h-16 flex items-center px-5 gap-3 border-b border-[#BFA071]/10 bg-[#0A0E1A]/40 backdrop-blur-sm">
        <div className="w-8 h-8 rounded-lg bg-[#BFA071] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(191,160,113,0.2)]">
          <Scale className="w-5 h-5 text-[#0A0E1A]" />
        </div>
        <span className="font-serif font-bold text-lg tracking-tight text-[#BFA071]">URAI</span>
        {profile?.subscription_tier === 'pro' && (
          <span className="ml-auto text-[9px] font-black px-2 py-0.5 rounded-full bg-[#BFA071]/10 text-[#BFA071] border border-[#BFA071]/30 tracking-widest">
            PRO
          </span>
        )}
      </div>

      {/* New Chat Button */}
      <div className="px-4 pt-5 pb-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border border-[#BFA071]/30 bg-[#BFA071]/5 text-[#BFA071] hover:bg-[#BFA071]/10 hover:border-[#BFA071] transition-all duration-300 text-sm font-semibold shadow-inner shadow-black/10"
        >
          <Plus className="w-4 h-4" />
          Новий чат
        </button>
      </div>

      {/* Chat History List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5 scrollbar-thin scrollbar-thumb-[#BFA071]/20 scrollbar-track-transparent">
        {chatsLoading && (
          <div className="flex flex-col items-center justify-center pt-10 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[#BFA071]/50" />
            <span className="text-[10px] text-[#BFA071]/70 uppercase tracking-widest">Завантаження...</span>
          </div>
        )}

        {!chatsLoading && chats.length === 0 && (
          <div className="text-center pt-10 px-6 opacity-40">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 text-[#BFA071]/70" />
            <p className="text-xs text-[#A0AEC0]">Розпочніть свій перший юридичний запит</p>
          </div>
        )}

        {groups.map(group => (
          <div key={group.label} className="space-y-1">
            <p className="text-[10px] font-bold text-[#BFA071]/70 uppercase tracking-[0.2em] px-3 mb-2">
              {group.label}
            </p>
            {group.items.map(chat => (
              <button
                key={chat.id}
                onClick={() => navigateOnSelect ? router.push(`/?chat=${chat.id}`) : onSelectChat(chat.id)}
                onMouseEnter={() => setHovered(chat.id)}
                onMouseLeave={() => setHovered(null)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 group relative ${currentChatId === chat.id
                  ? "bg-[#BFA071]/10 text-[#BFA071] border border-[#BFA071]/20 shadow-lg shadow-black/20"
                  : "text-[#A0AEC0] hover:bg-[#BFA071]/5 hover:text-[#E0E6ED]"
                  }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full transition-all ${currentChatId === chat.id ? "bg-[#BFA071]" : "bg-transparent group-hover:bg-[#BFA071]/30"}`} />
                <span className="flex-1 text-xs font-medium truncate">{chat.title}</span>

                {(hovered === chat.id || currentChatId === chat.id) && (
                  <button
                    onClick={e => handleDelete(e, chat.id)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-red-500/10 text-[#BFA071]/70 hover:text-red-400 transition-all active:scale-90"
                    title="Видалити чат"
                  >
                    {deleting === chat.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Bottom User Section */}
      <div className="border-t border-[#BFA071]/10 bg-[#0A0E1A]/40 p-3 space-y-1">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[#A0AEC0] hover:bg-[#BFA071]/5 hover:text-[#E0E6ED] transition-all text-xs font-medium group"
        >
          <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-500" />
          Налаштування
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-[#A0AEC0] hover:bg-red-500/5 hover:text-red-400 transition-all text-xs font-medium group"
        >
          <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Вийти
        </button>

        <div className="flex items-center gap-3 px-3 py-3 mt-2 border-t border-[#BFA071]/10 pt-4">
          <div className="w-9 h-9 rounded-xl bg-[#BFA071] border border-[#BFA071]/20 flex items-center justify-center text-[12px] font-bold text-[#0A0E1A] shrink-0 shadow-lg shadow-black/20">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#E0E6ED] truncate leading-none mb-1">{displayName}</p>
            <p className="text-[10px] text-[#BFA071]/50 truncate font-medium">{profile?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}