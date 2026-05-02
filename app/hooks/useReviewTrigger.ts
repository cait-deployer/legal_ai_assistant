"use client"

import { useState, useCallback, useRef } from "react"

export interface ReviewStatus {
  show:            boolean
  reward_eligible: boolean
  trigger_count:   number
  repeat_message_count: number
  reward_amount: number
  total_requests: number
}

const LATER_STORAGE_KEY = "urai_review_later_total_requests"
// Delay before showing the review modal — gives user time to read the response
const SHOW_DELAY_MS = 45_000

export function useReviewTrigger() {
  const [status, setStatus]             = useState<ReviewStatus | null>(null)
  const [buttonVisible, setButtonVisible] = useState(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingData  = useRef<ReviewStatus | null>(null)

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
        // Delay showing so user has time to read the response
        if (pendingTimer.current) clearTimeout(pendingTimer.current)
        pendingData.current = data
        pendingTimer.current = setTimeout(() => {
          setStatus(data)
          setButtonVisible(true)
        }, SHOW_DELAY_MS)
      }
    } catch {
      // Non-critical — silently ignore
    }
  }, [])

  // Re-open the modal from the inline button (after user closed it)
  const reopen = useCallback(() => {
    if (pendingData.current) setStatus(pendingData.current)
  }, [])

  const dismiss = useCallback(() => {
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
    setStatus(null)
    // Keep buttonVisible so user can reopen
  }, [])

  const postpone = useCallback(() => {
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
    setStatus(prev => {
      if (prev) window.localStorage.setItem(LATER_STORAGE_KEY, String(prev.total_requests))
      return null
    })
    setButtonVisible(false)
    pendingData.current = null
  }, [])

  const submitted = useCallback(() => {
    window.localStorage.removeItem(LATER_STORAGE_KEY)
    setButtonVisible(false)
    pendingData.current = null
  }, [])

  return { status, buttonVisible, check, reopen, dismiss, postpone, submitted }
}
