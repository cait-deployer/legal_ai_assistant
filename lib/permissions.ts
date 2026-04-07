import { createClient as createAdminClient } from "@supabase/supabase-js"

// ── Feature keys — single source of truth for code guards ─────────────────
export const PLAN_FEATURES = [
  "source_rada",
  "source_legalaid",
  "source_ccu",
  "source_supreme",
  "response_detailed",
  "response_steps",
  "response_scenarios",
  "response_vs_position",
  "history_saved",
  "priority_processing",
  "document_analysis",
] as const

export type FeatureKey = (typeof PLAN_FEATURES)[number]

// Domain mapping for source filtering in RAG
export const SOURCE_DOMAINS: Record<string, string> = {
  source_rada:     "zakon.rada.gov.ua",
  source_legalaid: "legalaid.gov.ua",
  source_ccu:      "ccu.gov.ua",
  source_supreme:  "supreme.court.gov.ua",
}

// ── Simple in-memory cache (plan_id → features, TTL 5 min) ────────────────
const featureCache = new Map<string, { features: Set<FeatureKey>; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Get enabled feature set for a plan ────────────────────────────────────
export async function getPlanFeatures(planId: string): Promise<Set<FeatureKey>> {
  const cached = featureCache.get(planId)
  if (cached && Date.now() < cached.expiresAt) return cached.features

  const { data } = await admin()
    .from("plan_features")
    .select("feature_key, enabled")
    .eq("plan_id", planId)
    .eq("enabled", true)

  const features = new Set<FeatureKey>(
    (data ?? []).map((r) => r.feature_key as FeatureKey)
  )
  featureCache.set(planId, { features, expiresAt: Date.now() + CACHE_TTL_MS })
  return features
}

// ── Get allowed RAG source domains for a plan ──────────────────────────────
export async function getAllowedDomains(planId: string): Promise<string[]> {
  const features = await getPlanFeatures(planId)
  return Object.entries(SOURCE_DOMAINS)
    .filter(([key]) => features.has(key as FeatureKey))
    .map(([, domain]) => domain)
}

// ── Guard: throws 403 Response if user lacks a feature ────────────────────
export async function requireFeature(
  planId: string,
  feature: FeatureKey
): Promise<void> {
  const features = await getPlanFeatures(planId)
  if (!features.has(feature)) {
    throw new Response(JSON.stringify({ error: "feature_not_available", feature }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }
}

// ── Invalidate cache for a plan (call after admin edits features) ──────────
export function invalidatePlanCache(planId: string) {
  featureCache.delete(planId)
}

export function invalidateAllPlanCache() {
  featureCache.clear()
}
