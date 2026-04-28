"use client"

import { useState, useCallback } from "react"

export interface ReviewStatus {
  show:            boolean
  reward_eligible: boolean
  trigger_count:   number
}

export function useReviewTrigger() {
  const [status, setStatus] = useState<ReviewStatus | null>(null)

  // Call after each successful AI response to check if modal should appear
  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/feedback/review/status")
      if (!res.ok) return
      const data: ReviewStatus = await res.json()
      if (data.show) {
        // Mark that we're showing the modal so it won't re-trigger this session
        await fetch("/api/feedback/review/status", { method: "PATCH" })
        setStatus(data)
      }
    } catch {
      // Non-critical — silently ignore
    }
  }, [])

  const dismiss = useCallback(() => setStatus(null), [])

  return { status, check, dismiss }
}
