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
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const perPage = Math.min(100, Math.max(10, parseInt(searchParams.get("per_page") ?? "25", 10) || 25))
  const sortDir = searchParams.get("sort_dir") === "asc" ? "asc" : "desc"
  const sortByParam = searchParams.get("sort_by") ?? "created_at"
  const sortColumns: Record<string, string> = {
    created_at: "created_at",
    processing_time_ms: "processing_time_ms",
    complexity_score: "complexity_score",
    category: "category",
    sentiment: "sentiment",
    user_intent: "user_intent",
    eval_status: "ai_eval->>eval_status",
  }
  const sortBy = sortColumns[sortByParam] ? sortByParam : "created_at"
  const sortColumn = sortColumns[sortBy]
  const from = (page - 1) * perPage
  const to = from + perPage - 1
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

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
    allProfilesRes,
    newUsersRes,
    messagesRes,
  ] = await Promise.all([
    sb.from("query_analytics").select("id", { count: "exact", head: true }),
    sb.from("query_analytics").select("id", { count: "exact", head: true }).gte("created_at", since),
    sb.from("query_analytics").select("category").gte("created_at", since).not("category", "is", null),
    sb.from("query_analytics").select("sentiment").gte("created_at", since).not("sentiment", "is", null),
    sb.from("query_analytics").select("user_intent").gte("created_at", since).not("user_intent", "is", null),
    sb.from("query_analytics").select("complexity_score").gte("created_at", since).not("complexity_score", "is", null),
    sb.from("query_analytics")
      .select("id, query_text, query_rewritten, ai_response, category, sentiment, complexity_score, processing_time_ms, user_intent, created_at, user_id, chat_id, message_id, ai_eval", { count: "exact" })
      .gte("created_at", since)
      .order(sortColumn, { ascending: sortDir === "asc", nullsFirst: false })
      .range(from, to),
    sb.from("query_analytics").select("user_id").gte("created_at", since).not("user_id", "is", null),
    sb.from("query_analytics").select("created_at").gte("created_at", since7),
    sb.from("query_analytics").select("processing_time_ms").gte("created_at", since).not("processing_time_ms", "is", null),
    // All profiles for conversion/retention
    sb.from("profiles").select("id, email, full_name, created_at"),
    // New users in period
    sb.from("profiles").select("id, created_at").gte("created_at", since),
    // Messages for session duration
    sb.from("messages").select("chat_id, created_at").gte("created_at", since).order("created_at", { ascending: true }),
  ])

  // ── Categories
  const categoryMap: Record<string, number> = {}
  for (const row of (categoryRes.data ?? [])) {
    const k = row.category ?? "Загальне"
    categoryMap[k] = (categoryMap[k] ?? 0) + 1
  }

  // ── Sentiments
  const sentimentMap: Record<string, number> = {}
  for (const row of (sentimentRes.data ?? [])) {
    const k = row.sentiment ?? "neutral"
    sentimentMap[k] = (sentimentMap[k] ?? 0) + 1
  }

  // ── Intents
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

  // ── Top users
  const userCountMap: Record<string, number> = {}
  for (const row of (topUsersRes.data ?? [])) {
    const k = row.user_id as string
    userCountMap[k] = (userCountMap[k] ?? 0) + 1
  }
  const topUserIds = Object.entries(userCountMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id)

  const profilesRes = topUserIds.length
    ? await sb.from("profiles").select("id, email, full_name").in("id", topUserIds)
    : { data: [] }

  const profileMap: Record<string, { email: string; full_name: string | null }> = {}
  for (const p of (profilesRes.data ?? [])) {
    profileMap[p.id] = { email: p.email ?? p.id.slice(0, 8) + "…", full_name: p.full_name ?? null }
  }
  const topUsers = topUserIds.map(user_id => ({
    user_id,
    count: userCountMap[user_id],
    email: profileMap[user_id]?.email ?? user_id.slice(0, 8) + "…",
    full_name: profileMap[user_id]?.full_name ?? null,
  }))

  // ── Daily trend
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

  // ── New users per day (last 7 days)
  const newUsersDayMap: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    newUsersDayMap[d.toISOString().slice(0, 10)] = 0
  }
  for (const row of (newUsersRes.data ?? [])) {
    const day = (row.created_at as string).slice(0, 10)
    if (day in newUsersDayMap) newUsersDayMap[day] = (newUsersDayMap[day] ?? 0) + 1
  }
  const newUsersPerDay = Object.entries(newUsersDayMap).map(([date, count]) => ({ date, count }))
  const newUsersTotal = newUsersRes.data?.length ?? 0

  // ── Retention: users with >1 query in period
  const usersWithQueries = Object.values(userCountMap)
  const returningUsers = usersWithQueries.filter(c => c > 1).length
  const totalActiveUsers = usersWithQueries.length
  const retentionRate = totalActiveUsers > 0
    ? Math.round((returningUsers / totalActiveUsers) * 100)
    : 0

  // ── Conversion: % of registered users who made at least 1 query
  const allProfileIds = new Set((allProfilesRes.data ?? []).map(p => p.id))
  const activeUserIds = new Set(Object.keys(userCountMap))
  const conversionRate = allProfileIds.size > 0
    ? Math.round((activeUserIds.size / allProfileIds.size) * 100)
    : 0

  // ── Avg session duration (first → last message per chat)
  const chatMsgMap: Record<string, { first: number; last: number }> = {}
  for (const msg of (messagesRes.data ?? [])) {
    const t = new Date(msg.created_at as string).getTime()
    if (!chatMsgMap[msg.chat_id]) chatMsgMap[msg.chat_id] = { first: t, last: t }
    else {
      chatMsgMap[msg.chat_id].first = Math.min(chatMsgMap[msg.chat_id].first, t)
      chatMsgMap[msg.chat_id].last  = Math.max(chatMsgMap[msg.chat_id].last, t)
    }
  }
  const durations = Object.values(chatMsgMap)
    .map(({ first, last }) => last - first)
    .filter(d => d > 0)
  const avgSessionMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null

  const recentRows = recentRes.data ?? []
  const recentIds = recentRows.map(row => row.id).filter(Boolean)
  const evalCasesRes = recentIds.length
    ? await sb
      .from("rag_eval_cases")
      .select("id, query_analytics_id, answer_type, has_direct_answer, expected_sources, bad_sources, eval_confidence, eval_notes, status, is_gold, reviewed_at, created_at")
      .in("query_analytics_id", recentIds)
    : { data: [] }

  const evalCaseMap: Record<string, unknown> = {}
  for (const item of (evalCasesRes.data ?? [])) {
    evalCaseMap[item.query_analytics_id as string] = item
  }
  const recent = recentRows.map(row => ({
    ...row,
    rag_eval_case: evalCaseMap[row.id] ?? null,
  }))

  return NextResponse.json({
    total: totalRes.count ?? 0,
    period: periodRes.count ?? 0,
    days,
    queriesPage: page,
    queriesPerPage: perPage,
    queriesTotal: recentRes.count ?? 0,
    queriesSortBy: sortBy,
    queriesSortDir: sortDir,
    avgComplexity,
    avgProcessingTimeMs: avgTime,
    categories: Object.entries(categoryMap).sort((a, b) => b[1] - a[1]),
    sentiments: Object.entries(sentimentMap).sort((a, b) => b[1] - a[1]),
    intents: Object.entries(intentMap).sort((a, b) => b[1] - a[1]),
    topUsers,
    dailyTrend,
    recent,
    // New metrics
    newUsersTotal,
    newUsersPerDay,
    retentionRate,
    conversionRate,
    avgSessionMs,
    totalUsers: allProfileIds.size,
    activeUsers: activeUserIds.size,
  })
}
