"use client"

import { useState } from "react"
import { ThumbsUp, ThumbsDown, Send, X } from "lucide-react"
import { AudioRecorderButton } from "./AudioRecorderButton"

const NEGATIVE_TAGS = [
  "Відповідь неточна",
  "Немає посилань",
  "Не стосується питання",
  "Незрозуміло",
]
const POSITIVE_TAGS = [
  "Точна відповідь",
  "Корисні посилання",
  "Зрозуміло",
  "Повна відповідь",
]

interface Props {
  messageId: string
  chatId:    string
}

type Vote = "positive" | "negative"

export function MessageFeedback({ messageId, chatId }: Props) {
  const [vote, setVote]             = useState<Vote | null>(null)
  const [expanded, setExpanded]     = useState(false)
  const [selectedTags, setTags]     = useState<string[]>([])
  const [text, setText]             = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  const handleVote = (v: Vote) => {
    const same = vote === v
    setVote(same ? null : v)
    setExpanded(!same)
    setTags([])
    setText("")
  }

  const toggleTag = (tag: string) =>
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await fetch("/api/feedback/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id:  messageId,
          chat_id:     chatId,
          is_positive: vote === "positive",
          tags:        selectedTags,
          feedback_text: text.trim() || null,
        }),
      })
      setSubmitted(true)
      setExpanded(false)
    } finally {
      setSubmitting(false)
    }
  }

  const tags = vote === "positive" ? POSITIVE_TAGS : NEGATIVE_TAGS

  return (
    <div className="mt-2">
      {/* Thumb buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleVote("positive")}
          className={[
            "p-1.5 rounded transition-colors",
            vote === "positive"
              ? "text-emerald-400"
              : "text-[#E0E6ED]/40 hover:text-emerald-400",
          ].join(" ")}
          title="Корисно"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleVote("negative")}
          className={[
            "p-1.5 rounded transition-colors",
            vote === "negative"
              ? "text-red-400"
              : "text-[#E0E6ED]/40 hover:text-red-400",
          ].join(" ")}
          title="Не корисно"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>

        {submitted && (
          <span className="text-xs text-[#E0E6ED]/50 ml-1">Дякуємо!</span>
        )}
      </div>

      {/* Expanded form */}
      {expanded && !submitted && (
        <div className="mt-2 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#E0E6ED]/60">
              {vote === "positive" ? "Що сподобалось?" : "Що покращити?"}
            </span>
            <button onClick={() => setExpanded(false)} className="text-[#E0E6ED]/40 hover:text-[#E0E6ED]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={[
                  "px-2 py-0.5 rounded-full text-xs border transition-colors",
                  selectedTags.includes(tag)
                    ? "bg-[#C9A84C]/20 border-[#C9A84C] text-[#C9A84C]"
                    : "border-white/15 text-[#E0E6ED]/60 hover:border-[#C9A84C]/50",
                ].join(" ")}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Text + audio row */}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Додатковий коментар (необов'язково)…"
              rows={2}
              className="flex-1 resize-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#E0E6ED] placeholder-[#E0E6ED]/30 focus:outline-none focus:border-[#C9A84C]/40"
            />
            <AudioRecorderButton onTranscription={(t) => setText((prev) => (prev ? prev + " " + t : t))} />
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[#C9A84C]/20 text-[#C9A84C] hover:bg-[#C9A84C]/30 disabled:opacity-50 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
