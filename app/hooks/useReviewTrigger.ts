"use client"

import { useState, useCallback } from "react"

export interface ReviewStatus {
  show:            boolean
  reward_eligible: boolean
  trigger_count:   number
  repeat_message_count: number
  reward_amount: number
  total_requests: number
}

const LATER_STORAGE_KEY = "urai_review_later_total_requests"

export function useReviewTrigger() {
  const [status, setStatus] = useState<ReviewStatus | null>(null)

  // Call after each successful AI response to check if modal should appear
  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback/review/status")
      if (!res.ok) return
      const data: ReviewStatus = await res.json()
      if (data.show) {
        const laterAtRaw = window.localStorage.getItem(LATER_STORAGE_KEY)
        const laterAt = laterAtRaw === null ? Number.NaN : Number(laterAtRaw)
        if (Number.isFinite(laterAt) && data.total_requests < laterAt + data.repeat_message_count) {
          return
        }
        // Mark that we're showing the modal so it won't re-trigger this session
        await fetch("/api/feedback/review/status", { method: "PATCH" })
        setStatus(data)
      }
    } catch {
      // Non-critical — silently ignore
    }
  }, [])

  const dismiss = useCallback(() => setStatus(null), [])

  const postpone = useCallback(() => {
    setStatus(prev => {
      if (prev) {
        window.localStorage.setItem(LATER_STORAGE_KEY, String(prev.total_requests))
      }
      return null
    })
  }, [])

  const submitted = useCallback(() => {
    window.localStorage.removeItem(LATER_STORAGE_KEY)
  }, [])

  return { status, check, dismiss, postpone, submitted }
}
