import type { ProbeLabContext } from "./probe-lab-context"
import { dispatchReplay, type ReplayResult } from "./replay-engine-dispatcher"
import type { Evidence, ProbeExchange, ProbeSession } from "./types"

export type ReplayModify = {
  headers_add?: Record<string, string>
  headers_remove?: ReadonlyArray<string>
  header_values_override?: Record<string, string>
  body_transform?: "none" | "strip_cif" | "preserve_only_user_message"
}

export type ReplayInput = {
  ctx: ProbeLabContext
  exchangeId: number
  modify?: ReplayModify
  fingerprintProfileId?: string
  sessionLabel?: string
}

export type ReplayPersistedResult = {
  exchange_id: number
  original_exchange_id: number
  evidence_id: number | null
  status: number
  timing_ms: number
  body_changed: boolean
  status_changed: boolean
}

export async function executeReplay(input: ReplayInput): Promise<ReplayPersistedResult> {
  const original = input.ctx.store.getExchange(input.exchangeId)
  if (!original) throw new Error(`exchange not found: ${input.exchangeId}`)
  const session = resolveSession(input.ctx, input.sessionLabel, original.session_id)
  if (!session) throw new Error(`session not found: ${original.session_id}`)
  const sourceEvidence = input.ctx.store.getLatestEvidenceForExchange(original.id)
  const headers = modifyHeaders(parseHeaders(original.request_headers), input.modify)
  const body = transformBody(toText(original.request_body), input.modify?.body_transform ?? "none")
  const outcome = await dispatchReplay({ ctx: input.ctx, original, sessionId: session.id, headers, body, fingerprintProfileId: input.fingerprintProfileId })
  const saved = persistExchange(input.ctx, session.id, original, headers, body, outcome)
  const evidenceId = persistEvidence(input.ctx, session.id, saved.id, sourceEvidence)
  return {
    exchange_id: saved.id,
    original_exchange_id: original.id,
    evidence_id: evidenceId,
    status: outcome.status,
    timing_ms: outcome.timing_ms,
    body_changed: toText(original.response_body) !== outcome.body,
    status_changed: original.response_status !== outcome.status,
  }
}

function resolveSession(ctx: ProbeLabContext, label: string | undefined, fallbackId: string): ProbeSession | null {
  if (!label) return ctx.store.getSession(fallbackId)
  const found = ctx.store.findSessionByLabel(label)
  if (found) return found
  return ctx.store.insertSession({ id: `replay-${Date.now()}-${Math.floor(Math.random() * 1000)}`, hypothesis_id: null, identity_id: null, config: { label, replay_of: fallbackId } })
}

function persistExchange(
  ctx: ProbeLabContext,
  sessionId: string,
  original: ProbeExchange,
  headers: Record<string, string>,
  body: string | null,
  outcome: ReplayResult,
): ProbeExchange {
  return ctx.store.insertExchange({
    session_id: sessionId,
    method: original.method,
    url: original.url,
    request_headers: headers,
    request_body: body,
    response_status: outcome.status,
    response_headers: outcome.headers,
    response_body: outcome.body,
    timing_total_ms: outcome.timing_ms,
    was_forwarded_as_is: true,
  })
}

function persistEvidence(
  ctx: ProbeLabContext,
  sessionId: string,
  exchangeId: number,
  source: Evidence | null,
): number | null {
  if (!source) return null
  const evidence = ctx.store.insertEvidence({
    hypothesis_id: source.hypothesis_id,
    session_id: sessionId,
    exchange_id: exchangeId,
    verdict: "inconclusive",
    reasoning: `Replay of evidence ${source.id}`,
    previous_evidence_id: source.id,
  })
  return evidence.id
}

function modifyHeaders(headers: Record<string, string>, modify?: ReplayModify): Record<string, string> {
  const out = { ...headers, ...(modify?.headers_add ?? {}) }
  for (const key of modify?.headers_remove ?? []) deleteHeader(out, key)
  Object.assign(out, modify?.header_values_override ?? {})
  return out
}

function deleteHeader(headers: Record<string, string>, key: string): void {
  const found = Object.keys(headers).find((existing) => existing.toLowerCase() === key.toLowerCase())
  if (found) delete headers[found]
}

function transformBody(body: string | null, mode: ReplayModify["body_transform"]): string | null {
  if (!body || mode === "none") return body
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (mode === "strip_cif") return JSON.stringify(stripCif(parsed))
    return JSON.stringify(preserveUserMessage(parsed))
  } catch {
    return body
  }
}

function stripCif(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) if (!key.toLowerCase().includes("cif")) out[key] = entry
  return out
}

function preserveUserMessage(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.message === "string") return { message: value.message }
  if (!Array.isArray(value.messages)) return value
  return { messages: value.messages.filter((msg) => isUserMessage(msg)) }
}

function isUserMessage(value: unknown): boolean {
  return value != null && typeof value === "object" && (value as Record<string, unknown>).role === "user"
}

function parseHeaders(json: string | null): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

function toText(value: Buffer | string | null): string | null {
  if (value == null) return null
  return typeof value === "string" ? value : value.toString("utf8")
}
