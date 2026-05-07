import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { GoogleAuth } from "google-auth-library"

export const runtime = "nodejs"
export const maxDuration = 60

type EvalSource = {
  num?: number
  title?: string | null
  law_id?: string | null
  collection?: string | null
  reason?: string | null
}

type EvalRecommendation = {
  action: "approve" | "reject" | "approve_gold"
  is_gold: boolean
  reason: string
}

type RagEval = {
  expected_answer_type: string
  has_direct_answer: boolean | null
  expected_sources: EvalSource[]
  bad_sources: EvalSource[]
  eval_confidence: number
  eval_notes: string
  eval_status: "ai_draft"
  recommendation?: EvalRecommendation | null
}

type FindResult = {
  found: boolean
  db_law_id: string | null
  db_title: string | null
  db_collection: string | null
  match_type: string | null
}

type AnnotatedSource = EvalSource & {
  in_db?: boolean
  db_title?: string | null
  db_collection?: string | null
}

const ANSWER_TYPES = new Set([
  "direct_norm",
  "no_direct_norm",
  "procedure",
  "risk_analysis",
  "document_draft",
  "clarification_needed",
  "mixed",
])

const STATUSES = new Set(["ai_draft", "human_reviewed", "approved", "rejected"])

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function checkAdmin() {
  const c = await cookies()
  return c.get("admin_session")?.value === "authenticated"
}

async function getVertexToken(saJson: string): Promise<string | null> {
  try {
    const sa = JSON.parse(saJson)
    const auth = new GoogleAuth({
      credentials: sa,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    })
    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    return tokenResponse.token ?? null
  } catch {
    return null
  }
}

function parseJsonObject(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function asArray(value: unknown): EvalSource[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {}
    return {
      num: typeof row.num === "number" ? row.num : undefined,
      title: typeof row.title === "string"
        ? row.title.slice(0, 300)
        : typeof row.source_title === "string"
          ? row.source_title.slice(0, 300)
          : null,
      law_id: typeof row.law_id === "string" ? row.law_id.slice(0, 160) : null,
      collection: typeof row.collection === "string" ? row.collection.slice(0, 120) : null,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 700) : null,
    }
  })
}

function clampConfidence(value: unknown) {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function normalizeRecommendation(value: unknown): EvalRecommendation | null {
  if (!value || typeof value !== "object") return null
  const r = value as Record<string, unknown>
  const action = typeof r.action === "string" && ["approve", "reject", "approve_gold"].includes(r.action)
    ? r.action as EvalRecommendation["action"]
    : null
  if (!action) return null
  return {
    action,
    is_gold: typeof r.is_gold === "boolean" ? r.is_gold : action === "approve_gold",
    reason: typeof r.reason === "string" ? r.reason.slice(0, 500) : "",
  }
}

function normalizeEval(value: Record<string, unknown> | null): RagEval {
  if (!value) throw new Error("AI eval returned empty or invalid JSON")

  const type = typeof value?.expected_answer_type === "string"
    ? value.expected_answer_type
    : typeof value?.answer_type === "string"
      ? value.answer_type
      : "mixed"

  const direct = typeof value?.has_direct_answer === "boolean" ? value.has_direct_answer : null

  return {
    expected_answer_type: ANSWER_TYPES.has(type) ? type : "mixed",
    has_direct_answer: direct,
    expected_sources: asArray(value?.expected_sources),
    bad_sources: asArray(value?.bad_sources),
    eval_confidence: clampConfidence(value?.eval_confidence),
    eval_notes: typeof value?.eval_notes === "string" ? value.eval_notes.slice(0, 4000) : "",
    eval_status: "ai_draft",
    recommendation: normalizeRecommendation(value?.recommendation),
  }
}

function validateEval(evalDraft: RagEval) {
  const hasSources = evalDraft.expected_sources.length > 0 || evalDraft.bad_sources.length > 0
  if (!evalDraft.eval_notes.trim() && !hasSources) {
    throw new Error("AI eval returned no notes and no source assessment")
  }
}

function compactSources(citations: unknown) {
  if (!Array.isArray(citations)) return []
  return citations.slice(0, 20).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {}
    return {
      num: row.num ?? null,
      title: row.source_title ?? row.title ?? null,
      law_id: row.law_id ?? row.id ?? null,
      collection: row.collection ?? row.source_collection ?? null,
      status: row.status ?? null,
      law_url: row.law_url ?? row.url ?? null,
      passage: typeof row.passage === "string" ? row.passage.slice(0, 900) : null,
      chunk_index: row.chunk_index ?? null,
    }
  })
}

function buildPrompt(input: {
  question: string
  questionRewritten: string | null
  answer: string | null
  actualSources: unknown[]
  feedback: unknown[]
}) {
  return `You are a legal RAG quality evaluator for a Ukrainian legal assistant.

Return ONLY valid JSON. Do not add markdown.

Language rule:
- All human-readable text values MUST be in Ukrainian.
- Do not write explanations in English, Russian, or mixed language.
- Keep technical enum values unchanged exactly as specified.

Allowed expected_answer_type values:
direct_norm | no_direct_norm | procedure | risk_analysis | document_draft | clarification_needed | mixed

JSON schema (return exactly this structure):
{
  "expected_answer_type": "one allowed value",
  "has_direct_answer": true | false | null,
  "expected_sources": [
    {
      "num": 1,
      "title": "назва закону/постанови",
      "law_id": "ідентифікатор у форматі rada (наприклад 80731-10, 254к/96-вр, 2341-14)",
      "collection": "назва колекції якщо відома",
      "reason": "чому це джерело потрібне для відповіді на це питання"
    }
  ],
  "bad_sources": [
    {
      "num": 2,
      "title": "...",
      "law_id": "...",
      "collection": "...",
      "reason": "чому це джерело слабке або нерелевантне"
    }
  ],
  "eval_confidence": 0.85,
  "eval_notes": "коротка примітка для людини-рецензента",
  "recommendation": {
    "action": "approve" | "reject" | "approve_gold",
    "is_gold": false,
    "reason": "1-2 речення чому саме така рекомендація"
  }
}

Rules for expected_sources:
- Include sources from actualSources that ARE relevant to the question.
- ALSO include laws/norms you know from legal training that SHOULD answer this question, even if RAG did NOT retrieve them.
- For Ukrainian laws use rada law_id format: numeric id like "80731-10", "254к/96-вр", "2341-14".
- Do NOT invent law_id if you are not certain — leave law_id null but provide the title.
- expected_sources = docs that SHOULD be retrieved for this question to be answered correctly.

Rules for bad_sources:
- Sources that were retrieved but are irrelevant, background-only, or misleading for this question.

Rules for recommendation:
- "approve" — query is well-formed, sources are evaluable → good eval case
- "approve_gold" — approve AND this is a canonical test case (important legal question, clear correct answer, high value for ongoing eval)
- "reject" — query is a follow-up ("так?", "зрозуміло", clarification request), too vague, or not RAG-evaluable

User question (raw):
${input.question}
${input.questionRewritten && input.questionRewritten !== input.question
  ? `\nRewritten question (what RAG actually searched on):
${input.questionRewritten}`
  : ""}

Answer:
${input.answer ?? ""}

Actual cited/retrieved sources:
${JSON.stringify(input.actualSources).slice(0, 12000)}

User/admin feedback:
${JSON.stringify(input.feedback).slice(0, 3000)}
`
}

async function loadSettings(sb: ReturnType<typeof admin>) {
  const { data } = await sb
    .from("app_settings")
    .select("key, value_text, value_int, value_bool")

  const settingsMap: Record<string, string> = {}
  for (const row of (data ?? [])) {
    const val = row.value_text ?? row.value_int ?? row.value_bool
    if (val != null && row.key) settingsMap[row.key] = String(val)
  }
  return settingsMap
}

async function evaluateWithVertex(prompt: string, settings: Record<string, string>) {
  const saJson = settings.service_account_json ?? ""
  if (!saJson) throw new Error("service_account_json is missing")

  const saObj = JSON.parse(saJson)
  const project = saObj.project_id as string | undefined
  if (!project) throw new Error("project_id is missing in service_account_json")

  const token = await getVertexToken(saJson)
  if (!token) throw new Error("vertex token failed")

  const location = settings.vertex_location ?? "us-central1"
  const modelName = settings.ai_model ?? "gemini-2.0-flash-lite"
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelName}:generateContent`

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(45000),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`vertex_${res.status}: ${detail.slice(0, 500)}`)
  }

  const data = await res.json()
  const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? []
  const raw = parts.map((part) => part.text ?? "").filter(Boolean).join("\n")
  if (!raw.trim()) {
    throw new Error("AI eval returned an empty response")
  }
  const evalDraft = normalizeEval(parseJsonObject(raw) as Record<string, unknown> | null)
  validateEval(evalDraft)
  return evalDraft
}

async function findAssistantMessageForAnalytics(
  sb: ReturnType<typeof admin>,
  row: { chat_id: string | null; message_id: string | null; ai_response: string | null },
) {
  if (row.message_id) {
    const { data: msg } = await sb
      .from("messages")
      .select("id, content, citations, created_at")
      .eq("id", row.message_id)
      .maybeSingle()
    if (msg) return msg
  }

  if (!row.chat_id) return null

  const { data: messages } = await sb
    .from("messages")
    .select("id, content, citations, created_at")
    .eq("chat_id", row.chat_id)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(25)

  const answer = (row.ai_response ?? "").trim()
  if (!messages?.length) return null
  if (!answer) return messages[0]

  const answerHead = answer.slice(0, 500)
  return messages.find((msg) => {
    const content = (msg.content ?? "").trim()
    return content === answer || content.startsWith(answerHead) || answer.startsWith(content.slice(0, 500))
  }) ?? messages[0]
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const sb = admin()

  const { data: row, error: rowError } = await sb
    .from("query_analytics")
    .select("id, user_id, chat_id, message_id, query_text, query_rewritten, ai_response, created_at")
    .eq("id", id)
    .single()

  if (rowError || !row) return NextResponse.json({ error: "Query analytics row not found" }, { status: 404 })

  let messageId = row.message_id as string | null
  let actualSources: unknown[] = []

  const assistantMessage = await findAssistantMessageForAnalytics(sb, {
    chat_id: row.chat_id,
    message_id: row.message_id,
    ai_response: row.ai_response,
  })
  messageId = assistantMessage?.id ?? messageId
  actualSources = compactSources(assistantMessage?.citations)

  const { data: feedback } = messageId
    ? await sb.from("message_feedback").select("*").eq("message_id", messageId).order("created_at", { ascending: false }).limit(5)
    : { data: [] }

  try {
    const settings = await loadSettings(sb)
    const evalDraft = await evaluateWithVertex(
      buildPrompt({
        question: row.query_text,
        questionRewritten: row.query_rewritten ?? null,
        answer: row.ai_response,
        actualSources,
        feedback: feedback ?? [],
      }),
      settings,
    )

    // Find each AI-suggested source in Qdrant — by law_id or by title (vector search)
    const allSources = [...evalDraft.expected_sources, ...evalDraft.bad_sources]
    const hints = allSources.map(s => ({ law_id: s.law_id ?? null, title: s.title ?? null }))

    let findResults: FindResult[] = hints.map(() => ({ found: false, db_law_id: null, db_title: null, db_collection: null, match_type: null }))
    if (hints.some(h => h.law_id || h.title)) {
      try {
        const findRes = await fetch(
          `${process.env.BACKEND_URL || process.env.API_URL || "http://localhost:8000"}/admin/eval/find_sources`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sources: hints }),
            signal: AbortSignal.timeout(25000),
          },
        )
        if (findRes.ok) findResults = await findRes.json()
      } catch { /* non-fatal */ }
    }

    const expLen = evalDraft.expected_sources.length

    function annotateWithFind(sources: EvalSource[], offset: number): AnnotatedSource[] {
      return sources.map((s, i) => {
        const r = findResults[offset + i]
        if (!r?.found) return { ...s, in_db: false }
        return {
          ...s,
          // Fill in law_id and title from DB when AI left them empty
          law_id: s.law_id || r.db_law_id || null,
          title: s.title || r.db_title || null,
          collection: s.collection || r.db_collection || null,
          in_db: true,
          db_title: r.db_title,
          db_collection: r.db_collection,
        }
      })
    }

    const annotatedExpected = annotateWithFind(evalDraft.expected_sources, 0)
    const annotatedBad = annotateWithFind(evalDraft.bad_sources, expLen)

    await sb
      .from("query_analytics")
      .update({ ai_eval: evalDraft, message_id: messageId })
      .eq("id", id)

    const { data: evalCase, error: caseError } = await sb
      .from("rag_eval_cases")
      .upsert({
        query_analytics_id: id,
        message_id: messageId,
        chat_id: row.chat_id,
        user_id: row.user_id,
        question: row.query_text,
        answer: row.ai_response,
        actual_sources: actualSources,
        expected_sources: annotatedExpected,
        bad_sources: annotatedBad,
        answer_type: evalDraft.expected_answer_type,
        has_direct_answer: evalDraft.has_direct_answer,
        eval_confidence: evalDraft.eval_confidence,
        eval_notes: evalDraft.eval_notes,
        status: "ai_draft",
      }, { onConflict: "query_analytics_id" })
      .select()
      .single()

    if (caseError) throw new Error(caseError.message)
    return NextResponse.json({
      ok: true,
      eval: evalCase,
      ai_eval: evalDraft,
      annotated_expected: annotatedExpected,
      annotated_bad: annotatedBad,
      recommendation: evalDraft.recommendation ?? null,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await request.json()
  const sb = admin()

  const patch: Record<string, unknown> = {}
  if (typeof body.status === "string" && STATUSES.has(body.status)) patch.status = body.status
  if (typeof body.is_gold === "boolean") patch.is_gold = body.is_gold
  if (typeof body.answer_type === "string" && ANSWER_TYPES.has(body.answer_type)) patch.answer_type = body.answer_type
  if ("has_direct_answer" in body) {
    patch.has_direct_answer = typeof body.has_direct_answer === "boolean" ? body.has_direct_answer : null
  }
  if (Array.isArray(body.expected_sources)) patch.expected_sources = body.expected_sources
  if (Array.isArray(body.bad_sources)) patch.bad_sources = body.bad_sources
  if (typeof body.eval_notes === "string") patch.eval_notes = body.eval_notes.slice(0, 4000)
  if ("eval_confidence" in body) patch.eval_confidence = clampConfidence(body.eval_confidence)

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 })
  }

  if (patch.status && patch.status !== "ai_draft") {
    patch.reviewed_at = new Date().toISOString()
  }

  const { data: evalCase, error } = await sb
    .from("rag_eval_cases")
    .update(patch)
    .eq("query_analytics_id", id)
    .select()
    .single()

  if (error || !evalCase) {
    return NextResponse.json({ error: error?.message ?? "Eval case not found" }, { status: 404 })
  }

  await sb
    .from("query_analytics")
    .update({
      ai_eval: {
        expected_answer_type: evalCase.answer_type,
        has_direct_answer: evalCase.has_direct_answer,
        expected_sources: evalCase.expected_sources,
        bad_sources: evalCase.bad_sources,
        eval_confidence: evalCase.eval_confidence,
        eval_notes: evalCase.eval_notes,
        eval_status: evalCase.status,
      },
    })
    .eq("id", id)

  return NextResponse.json({ ok: true, eval: evalCase })
}
