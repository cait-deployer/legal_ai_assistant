import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

export async function GET(request: Request) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get("days") ?? "30", 10)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const sb = admin()

  const [
    totalRes,
    periodRes,
    categoryRes,
    sentimentRes,
    intentRes,
    complexityRes,
    recentRes,
    topUsersRes,
    dailyRes,
    avgTimeRes,
  ] = await Promise.all([
    // Total all-time
    sb.from("query_analytics").select("id", { count: "exact", head: true }),

    // Period count
    sb.from("query_analytics")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),

    // By category (period)
    sb.from("query_analytics")
      .select("category")
      .gte("created_at", since)
      .not("category", "is", null),

    // By sentiment (period)
    sb.from("query_analytics")
      .select("sentiment")
      .gte("created_at", since)
      .not("sentiment", "is", null),

    // By user_intent (period)
    sb.from("query_analytics")
      .select("user_intent")
      .gte("created_at", since)
      .not("user_intent", "is", null),

    // Avg complexity
    sb.from("query_analytics")
      .select("complexity_score")
      .gte("created_at", since)
      .not("complexity_score", "is", null),

    // Recent 20 queries
    sb.from("query_analytics")
      .select("id, query_text, category, sentiment, complexity_score, processing_time_ms, user_intent, created_at, user_id")
      .order("created_at", { ascending: false })
      .limit(20),

    // Top users by query count (period) — join email from profiles
    sb.from("query_analytics")
      .select("user_id, profiles(email, full_name)")
      .gte("created_at", since)
      .not("user_id", "is", null),

    // Daily counts last 7 days
    sb.from("query_analytics")
      .select("created_at")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),

    // Avg processing time
    sb.from("query_analytics")
      .select("processing_time_ms")
      .gte("created_at", since)
      .not("processing_time_ms", "is", null),
  ])

  // ── Aggregate categories
  const categoryMap: Record<string, number> = {}
  for (const row of (categoryRes.data ?? [])) {
    const k = row.category ?? "Загальне"
    categoryMap[k] = (categoryMap[k] ?? 0) + 1
  }

  // ── Aggregate sentiments
  const sentimentMap: Record<string, number> = {}
  for (const row of (sentimentRes.data ?? [])) {
    const k = row.sentiment ?? "neutral"
    sentimentMap[k] = (sentimentMap[k] ?? 0) + 1
  }

  // ── Aggregate user intents
  const intentMap: Record<string, number> = {}
  for (const row of (intentRes.data ?? [])) {
    const k = row.user_intent ?? "консультація"
    intentMap[k] = (intentMap[k] ?? 0) + 1
  }

  // ── Avg complexity
  const complexityScores = (complexityRes.data ?? []).map(r => r.complexity_score).filter(Boolean)
  const avgComplexity = complexityScores.length
    ? (complexityScores.reduce((a: number, b: number) => a + b, 0) / complexityScores.length).toFixed(1)
    : null

  // ── Top users (with email/name from joined profiles)
  const userMap: Record<string, { count: number; email: string; full_name: string | null }> = {}
  for (const row of (topUsersRes.data ?? [])) {
    const k = row.user_id
    const profile = (row as { profiles?: { email?: string; full_name?: string | null } }).profiles
    if (!userMap[k]) {
      userMap[k] = {
        count: 0,
        email: profile?.email ?? k.slice(0, 8) + "…",
        full_name: profile?.full_name ?? null,
      }
    }
    userMap[k].count += 1
  }
  const topUsers = Object.entries(userMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([user_id, { count, email, full_name }]) => ({ user_id, count, email, full_name }))

  // ── Daily trend (last 7 days)
  const dayMap: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    dayMap[d.toISOString().slice(0, 10)] = 0
  }
  for (const row of (dailyRes.data ?? [])) {
    const day = (row.created_at as string).slice(0, 10)
    if (day in dayMap) dayMap[day] = (dayMap[day] ?? 0) + 1
  }
  const dailyTrend = Object.entries(dayMap).map(([date, count]) => ({ date, count }))

  // ── Avg processing time
  const times = (avgTimeRes.data ?? []).map(r => r.processing_time_ms).filter(Boolean)
  const avgTime = times.length
    ? Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length)
    : null

  return NextResponse.json({
    total: totalRes.count ?? 0,
    period: periodRes.count ?? 0,
    days,
    avgComplexity,
    avgProcessingTimeMs: avgTime,
    categories: Object.entries(categoryMap).sort((a, b) => b[1] - a[1]),
    sentiments: Object.entries(sentimentMap).sort((a, b) => b[1] - a[1]),
    intents: Object.entries(intentMap).sort((a, b) => b[1] - a[1]),
    topUsers,
    dailyTrend,
    recent: recentRes.data ?? [],
  })
}
