import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

const BACKEND = process.env.API_URL || "http://localhost:8000"

// Map plan feature keys → backend source names
const SOURCE_FEATURE_MAP: Record<string, string> = {
  source_rada:     "rada",
  source_legalaid: "wiki",
  source_supreme:  "supreme",
  source_ccu:      "ccu",
  source_lpd:      "lpd",
  source_kmu:      "kmu",
  source_mod:      "mod",
  source_zir:      "zir",
}

// Response quality feature keys (passed as-is to backend)
const RESPONSE_FEATURES = new Set([
  "response_detailed",
  "response_steps",
  "response_scenarios",
  "response_vs_position",
])

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  // 1. Authenticate user
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { question, history, context_summary } = body

  // 2. Get user's subscription_tier + onboarding profile
  const { data: profile } = await admin()
    .from("profiles")
    .select("subscription_tier, is_beta_tester, role, sub_role, segment, ai_personal_prompt, response_length_pref, response_lang_style")
    .eq("id", user.id)
    .single()

  let filter_sources: string[] | null = null
  let response_features: string[] = []
  let max_docs = 8

  // Build user profile for prompt personalization
  const user_profile = profile ? {
    role:     profile.role     ?? null,
    sub_role: profile.sub_role ?? [],
    segment:  profile.segment  ?? [],
  } : null

  const effectivePlanId = profile?.is_beta_tester ? "pro" : profile?.subscription_tier

  if (effectivePlanId) {
    const planId = effectivePlanId

    // 3. Get plan limits (id IS the slug)
    const { data: plan } = await admin()
      .from("subscription_plans")
      .select("max_docs_retrieved")
      .eq("id", planId)
      .single()

    if (plan) {
      max_docs = plan.max_docs_retrieved ?? 8
    }

    // 4. Get all enabled features for this plan
    const { data: features } = await admin()
      .from("plan_features")
      .select("feature_key")
      .eq("plan_id", planId)
      .eq("enabled", true)

    if (features && features.length > 0) {
      // Source filter
      const sources = features
        .map((f) => SOURCE_FEATURE_MAP[f.feature_key])
        .filter(Boolean) as string[]
      if (sources.length > 0) filter_sources = [...new Set([...sources, "mod", "zir"])]

      // Response quality features
      response_features = features
        .map((f) => f.feature_key)
        .filter((k) => RESPONSE_FEATURES.has(k))
    }
  }

  // 5. Gating response preferences by plan tier
  const tier = profile?.is_beta_tester ? "pro" : (profile?.subscription_tier ?? "free")
  const isBasicPlus = tier !== "free"
  const isProPlus   = tier === "pro"

  let response_length_pref = (profile?.response_length_pref ?? "standard") as string
  let response_lang_style  = (profile?.response_lang_style  ?? "legal")    as string

  // Downgrade locked preferences silently if plan doesn't allow them
  if (response_length_pref === "full"     && !isProPlus)   response_length_pref = "standard"
  if (response_length_pref === "detailed" && !isBasicPlus) response_length_pref = "standard"

  // 6. Forward to Python backend with plan-based params
  try {
    const res = await fetch(`${BACKEND}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, max_docs, filter_sources, response_features, user_profile, history: history ?? null, context_summary: context_summary ?? null, ai_personal_prompt: profile?.ai_personal_prompt ?? null, response_length_pref, response_lang_style }),
      signal: AbortSignal.timeout(180_000),
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    console.error("[api/ask] backend error:", err)
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
