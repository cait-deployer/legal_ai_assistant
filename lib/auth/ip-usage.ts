import type { SupabaseClient } from "@supabase/supabase-js"

type ProfileUsage = {
  id: string
  subscription_tier: string | null
  monthly_limit: number | null
  requests_this_month: number | null
  total_requests: number | null
  limit_reset_at: string | null
  trial_used: boolean | null
  is_premium: boolean | null
  created_at: string | null
}

type UsagePatch = {
  subscription_tier?: string
  monthly_limit?: number | null
  requests_this_month?: number
  total_requests?: number
  limit_reset_at?: string | null
  trial_used?: boolean
}

function isFreeLike(profile: ProfileUsage | null | undefined) {
  if (!profile) return true
  const tier = profile.subscription_tier ?? "free"
  return !profile.is_premium && (tier === "free" || tier === "trial")
}

function toCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function maxCount(a: number | null | undefined, b: number | null | undefined) {
  return Math.max(toCount(a), toCount(b))
}

export async function getIpUsageInheritancePatch(
  admin: SupabaseClient,
  userId: string,
  ip: string | null | undefined,
): Promise<UsagePatch> {
  if (!ip) return {}

  const { data: current } = await admin
    .from("profiles")
    .select("id, subscription_tier, monthly_limit, requests_this_month, total_requests, limit_reset_at, trial_used, is_premium, created_at")
    .eq("id", userId)
    .maybeSingle<ProfileUsage>()

  if (!isFreeLike(current)) return {}

  const { data: sameIpProfiles } = await admin
    .from("profiles")
    .select("id, subscription_tier, monthly_limit, requests_this_month, total_requests, limit_reset_at, trial_used, is_premium, created_at")
    .eq("last_ip", ip)
    .neq("id", userId)
    .order("created_at", { ascending: true })
    .limit(25)
    .returns<ProfileUsage[]>()

  if (!sameIpProfiles?.length) return {}

  const usageSource = sameIpProfiles.reduce((best, profile) => {
    return toCount(profile.requests_this_month) > toCount(best.requests_this_month) ? profile : best
  }, sameIpProfiles[0])
  const freeTierSource = sameIpProfiles.find(isFreeLike)

  const inheritedUsed = maxCount(current?.requests_this_month, usageSource.requests_this_month)
  const inheritedTotal = maxCount(current?.total_requests, usageSource.total_requests)
  const patch: UsagePatch = {
    requests_this_month: inheritedUsed,
    total_requests: inheritedTotal,
  }

  if (usageSource.limit_reset_at && !current?.limit_reset_at) {
    patch.limit_reset_at = usageSource.limit_reset_at
  }

  if (usageSource.trial_used || inheritedUsed > 0 || inheritedTotal > 0) {
    patch.trial_used = true
  }

  if (freeTierSource) {
    patch.subscription_tier = freeTierSource.subscription_tier ?? "free"
    patch.monthly_limit = freeTierSource.monthly_limit
    if (freeTierSource.limit_reset_at) {
      patch.limit_reset_at = freeTierSource.limit_reset_at
    }
  }

  return patch
}
