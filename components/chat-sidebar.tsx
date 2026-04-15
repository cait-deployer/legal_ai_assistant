"use client"

import { useEffect, useRef, useState } from "react"
import useSWR, { mutate } from "swr"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Plus, Settings, LogOut, MessageSquare, Trash2,
  ChevronRight, Scale, Loader2, X,
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
  isOpen?: boolean
  onClose?: () => void
}

export function ChatSidebar({ currentChatId, onNewChat, onSelectChat, navigateOnSelect, isOpen = false, onClose }: Props) {
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

  const handleSelect = (chatId: string) => {
    if (navigateOnSelect) {
      router.push(`/chat?chat=${chatId}`)
    } else {
      onSelectChat(chatId)
    }
    onClose?.()
  }

  const handleNewChat = () => {
    onNewChat()
    onClose?.()
  }

  const groups = groupByDate(chats)
  const displayName = profile?.full_name?.split(" ")[0] ?? profile?.email?.split("@")[0] ?? "Користувач"
  const initials = (profile?.full_name ?? profile?.email ?? "U")
    .split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col
          md:relative md:inset-auto md:z-auto md:w-[270px] md:translate-x-0 md:shrink-0
          bg-[#0d1120] text-[#E0E6ED] border-r border-[#C9A84C]/20 select-none
          transition-transform duration-300 ease-in-out h-screen
          ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        {/* Logo Section */}
        <div className="h-16 flex items-center px-5 gap-3 border-b border-[#C9A84C]/10 bg-[#0A0E1A]/40 backdrop-blur-sm shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#C9A84C] flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(201,168,76,0.2)]">
            <Scale className="w-5 h-5 text-[#0A0E1A]" />
          </div>
          <span className="font-serif font-bold text-lg tracking-tight text-[#C9A84C]">URAI</span>
          {profile?.subscription_tier === 'pro' && (
            <span className="ml-auto text-[9px] font-black px-2 py-0.5 rounded-full bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/30 tracking-widest">
              PRO
            </span>
          )}
          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="ml-auto md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-[#C9A84C]/50 hover:text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-4 pt-4 pb-3 shrink-0">
          <button
            data-tour="new-chat"
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/5 text-[#C9A84C] hover:bg-[#C9A84C]/10 hover:border-[#C9A84C] active:scale-[0.98] transition-all duration-300 text-sm font-semibold shadow-inner shadow-black/10"
          >
            <Plus className="w-4 h-4" />
            Новий чат
          </button>
        </div>

        {/* Chat History List */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5 scrollbar-thin scrollbar-thumb-[#C9A84C]/20 scrollbar-track-transparent">
          {chatsLoading && (
            <div className="flex flex-col items-center justify-center pt-10 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-[#C9A84C]/50" />
              <span className="text-[10px] text-[#C9A84C]/70 uppercase tracking-widest">Завантаження...</span>
            </div>
          )}

          {!chatsLoading && chats.length === 0 && (
            <div className="text-center pt-10 px-6 opacity-40">
              <MessageSquare className="w-8 h-8 mx-auto mb-3 text-[#C9A84C]/70" />
              <p className="text-xs text-[#A0AEC0]">Розпочніть свій перший юридичний запит</p>
            </div>
          )}

          {groups.map(group => (
            <div key={group.label} className="space-y-1">
              <p className="text-[10px] font-bold text-[#C9A84C]/70 uppercase tracking-[0.2em] px-3 mb-2">
                {group.label}
              </p>
              {group.items.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => handleSelect(chat.id)}
                  onMouseEnter={() => setHovered(chat.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={`w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-xl text-left transition-all duration-200 group relative ${
                    currentChatId === chat.id
                      ? "bg-[#C9A84C]/10 text-[#C9A84C] border border-[#C9A84C]/20 shadow-lg shadow-black/20"
                      : "text-[#A0AEC0] hover:bg-[#C9A84C]/5 hover:text-[#E0E6ED]"
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${currentChatId === chat.id ? "bg-[#C9A84C]" : "bg-transparent group-hover:bg-[#C9A84C]/30"}`} />
                  <span className="flex-1 text-xs font-medium truncate">{chat.title}</span>

                  {(hovered === chat.id || currentChatId === chat.id) && (
                    <button
                      onClick={e => handleDelete(e, chat.id)}
                      className="shrink-0 p-2 rounded-lg hover:bg-red-500/10 text-[#C9A84C]/70 hover:text-red-400 transition-all active:scale-90"
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
        <div className="border-t border-[#C9A84C]/10 bg-[#0A0E1A]/40 p-3 space-y-1 shrink-0">
          <Link
            href="/settings"
            data-tour="settings-link"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-[#A0AEC0] hover:bg-[#C9A84C]/5 hover:text-[#E0E6ED] transition-all text-xs font-medium group"
          >
            <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-500" />
            Налаштування
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[#A0AEC0] hover:bg-red-500/5 hover:text-red-400 transition-all text-xs font-medium group"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Вийти
          </button>

          <div className="flex items-center gap-3 px-3 py-3 mt-1 border-t border-[#C9A84C]/10 pt-4">
            <div className="w-9 h-9 rounded-xl bg-[#C9A84C] border border-[#C9A84C]/20 flex items-center justify-center text-[12px] font-bold text-[#0A0E1A] shrink-0 shadow-lg shadow-black/20">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#E0E6ED] truncate leading-none mb-1">{displayName}</p>
              <p className="text-[10px] text-[#C9A84C]/50 truncate font-medium">{profile?.email}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
