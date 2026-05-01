import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

const BACKEND = process.env.API_URL || "http://localhost:8000"

export const runtime = "nodejs"
export const maxDuration = 300

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
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { question, history, context_summary } = body

  const { data: profile } = await admin()
    .from("profiles")
    .select("subscription_tier, role, sub_role, segment, ai_personal_prompt, response_length_pref, response_lang_style")
    .eq("id", user.id)
    .single()

  let filter_sources: string[] | null = null
  let response_features: string[] = []
  let max_docs = 8

  const user_profile = profile ? {
    role:     profile.role     ?? null,
    sub_role: profile.sub_role ?? [],
    segment:  profile.segment  ?? [],
  } : null

  if (profile?.subscription_tier) {
    const planId = profile.subscription_tier

    const { data: plan } = await admin()
      .from("subscription_plans")
      .select("max_docs_retrieved")
      .eq("id", planId)
      .single()

    if (plan) {
      max_docs = plan.max_docs_retrieved ?? 8
    }

    const { data: features } = await admin()
      .from("plan_features")
      .select("feature_key")
      .eq("plan_id", planId)
      .eq("enabled", true)

    if (features && features.length > 0) {
      const sources = features
        .map((f) => SOURCE_FEATURE_MAP[f.feature_key])
        .filter(Boolean) as string[]
      if (sources.length > 0) filter_sources = [...new Set([...sources, "mod", "zir"])]

      response_features = features
        .map((f) => f.feature_key)
        .filter((k) => RESPONSE_FEATURES.has(k))
    }
  }

  const tier = profile?.subscription_tier ?? "free"
  const isBasicPlus = tier === "basic" || tier === "pro" || tier === "ultra"
  const isProPlus   = tier === "pro" || tier === "ultra"

  let response_length_pref = (profile?.response_length_pref ?? "standard") as string
  let response_lang_style  = (profile?.response_lang_style  ?? "legal")    as string

  if (response_length_pref === "full"     && !isProPlus)   response_length_pref = "standard"
  if (response_length_pref === "detailed" && !isBasicPlus) response_length_pref = "standard"
  if (response_lang_style  === "plain"    && !isBasicPlus) response_lang_style  = "legal"

  try {
    const res = await fetch(`${BACKEND}/ask_stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, max_docs, filter_sources, response_features, user_profile, history: history ?? null, context_summary: context_summary ?? null, ai_personal_prompt: profile?.ai_personal_prompt ?? null, response_length_pref, response_lang_style }),
      signal: AbortSignal.timeout(185_000),
    })

    if (!res.body) {
      return NextResponse.json({ error: "No stream from backend" }, { status: 502 })
    }

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (err) {
    console.error("[api/ask/stream] backend error:", err)
    return NextResponse.json({ error: "Backend unavailable" }, { status: 503 })
  }
}
