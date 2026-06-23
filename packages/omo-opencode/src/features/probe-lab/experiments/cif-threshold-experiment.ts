import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../probe-lab-context"
import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"
import { buildSizedPrompt } from "./cif-threshold-prompt-builder"
import { extractCifSseSignals } from "./cif-threshold-signal-extractor"
import type {
  CifThresholdProbeOutcome,
  CifThresholdScanInput,
  CifThresholdScanResult,
} from "./cif-threshold-types"

const COMPLETION_PATH = "/api/v0/chat/completion"
const SESSION_CREATE_PATH = "/api/v0/chat_session/create"
const DEFAULT_PACE_MS = 8000
const DEFAULT_TIMEOUT_MS = 90_000

export type CifChatSessionFactory = (
  provider: ProbeProvider,
  baseUrl: string,
) => Promise<{ session_id: string | null; raw_status: number; raw_body: string }>

export const defaultChatSessionFactory: CifChatSessionFactory = async (provider, baseUrl) => {
  const url = `${baseUrl.replace(/\/$/, "")}${SESSION_CREATE_PATH}`
  const req: ProbeRequest = {
    url, method: "POST", headers: {}, body: JSON.stringify({ agent: "chat" }),
    timeout_ms: 30_000, forward_as_is: false,
    metadata: { session_id: `bootstrap-${randomUUID()}`, exchange_sequence: 1 },
  }
  const res = await provider.dispatchProbe(req)
  const id = parseSessionIdFromBody(res.body)
  return { session_id: id, raw_status: res.status, raw_body: res.body }
}

function parseSessionIdFromBody(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { data?: { biz_data?: { id?: string } }; id?: string }
    return parsed?.data?.biz_data?.id ?? parsed?.id ?? null
  } catch { return null }
}

export async function runCifThresholdScan(
  ctx: ProbeLabContext,
  input: CifThresholdScanInput,
  opts?: {
    chatSessionFactory?: CifChatSessionFactory
    sleep?: (ms: number) => Promise<void>
    base_url_override?: string
    provider_override?: ProbeProvider
  },
): Promise<CifThresholdScanResult> {
  let provider: ProbeProvider | null = opts?.provider_override ?? null
  if (!provider) {
    ctx.providerRegistry.loadAll()
    provider = ctx.providerRegistry.get(input.provider_id)
  }
  if (!provider) throw new Error(`provider not found: ${input.provider_id}`)
  const creds = ctx.store.getProvider(input.provider_id)
  if (!creds && !opts?.base_url_override) throw new Error(`provider credentials not found: ${input.provider_id}`)
  const baseUrl = opts?.base_url_override ?? creds!.base_url
  const sessionFactory = opts?.chatSessionFactory ?? defaultChatSessionFactory
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const fresh = input.fresh_session_per_probe !== false
  const labelBase = input.session_label_base ?? `cif-scan-${Date.now()}`

  const outcomes: CifThresholdProbeOutcome[] = []
  const exchangeIds: number[] = []
  let aborted = false
  let abortReason: string | null = null

  let sharedChatId: string | null = null
  if (!fresh) {
    const created = await sessionFactory(provider, baseUrl)
    sharedChatId = created.session_id
  }

  for (let i = 0; i < input.sizes.length; i++) {
    if (i > 0) await sleep(input.pace_ms ?? DEFAULT_PACE_MS)
    const size = input.sizes[i]
    const chatId = fresh
      ? (await sessionFactory(provider, baseUrl)).session_id
      : sharedChatId
    if (!chatId) {
      const outcome = makeAbortedOutcome(size, "session_create_failed", -1)
      outcomes.push(outcome)
      aborted = true
      abortReason = `session_create_failed at size=${size}`
      break
    }
    const outcome = await runOneProbe({
      ctx, provider, baseUrl, hypothesisId: input.hypothesis_id, sizeChars: size,
      promptTemplate: input.prompt_template, chatSessionId: chatId,
      sessionLabel: `${labelBase}-s${size}`,
    })
    outcomes.push(outcome)
    if (outcome.exchange_id > 0) exchangeIds.push(outcome.exchange_id)
  }

  return {
    exchange_ids: exchangeIds,
    outcomes,
    threshold_estimate: estimateThreshold(outcomes),
    behavior_changes_at: findFirstBehaviorChange(outcomes),
    aborted, abort_reason: abortReason,
  }
}

async function runOneProbe(args: {
  ctx: ProbeLabContext
  provider: ProbeProvider
  baseUrl: string
  hypothesisId: string
  sizeChars: number
  promptTemplate?: string
  chatSessionId: string
  sessionLabel: string
}): Promise<CifThresholdProbeOutcome> {
  const prompt = buildSizedPrompt(args.sizeChars, args.promptTemplate)
  const url = `${args.baseUrl.replace(/\/$/, "")}${COMPLETION_PATH}`
  const body = JSON.stringify({
    chat_session_id: args.chatSessionId, parent_message_id: null,
    prompt, ref_file_ids: [], thinking_enabled: false, search_enabled: false,
  })
  const labSession = args.ctx.store.insertSession({
    id: `sess-${randomUUID()}`, hypothesis_id: args.hypothesisId, identity_id: null,
    provider_id: args.provider.id, config: { label: args.sessionLabel, size_chars: args.sizeChars },
  })
  const req: ProbeRequest = {
    url, method: "POST", headers: {}, body,
    timeout_ms: DEFAULT_TIMEOUT_MS, forward_as_is: false,
    metadata: { session_id: labSession.id, hypothesis_id: args.hypothesisId, exchange_sequence: 1 },
  }
  const t0 = Date.now()
  const res = await args.provider.dispatchProbe(req)
  const elapsed = Date.now() - t0
  const signals = extractCifSseSignals(res.body)
  const exchange = args.ctx.store.insertExchange({
    session_id: labSession.id, method: "POST", url,
    request_headers: req.headers, request_body: body,
    response_status: res.status, response_headers: res.headers,
    response_body: res.body, timing_total_ms: res.timing.total_ms ?? elapsed,
    was_forwarded_as_is: false,
  })
  const completedNormally = res.status === 200 && signals.terminal_status === "FINISHED"
  return {
    size_chars: args.sizeChars, exchange_id: exchange.id, status: res.status,
    ttft_ms: res.timing.first_byte_ms ?? null, total_ms: res.timing.total_ms ?? elapsed,
    sse_event_count: signals.sse_event_count, data_chunk_count: signals.data_chunk_count,
    content_text: signals.content_text, content_chars: signals.content_text.length,
    token_usage: signals.token_usage, terminal_status: signals.terminal_status,
    completed_normally: completedNormally, empty_sse: signals.empty_sse && res.status === 200,
    error_message: res.error?.message ?? null,
    body_preview: res.body.length <= 500 ? res.body : `${res.body.slice(0, 500)}…[truncated]`,
    chat_session_id: args.chatSessionId,
  }
}

function makeAbortedOutcome(size: number, reason: string, status: number): CifThresholdProbeOutcome {
  return {
    size_chars: size, exchange_id: -1, status, ttft_ms: null, total_ms: 0,
    sse_event_count: 0, data_chunk_count: 0, content_text: "", content_chars: 0,
    token_usage: null, terminal_status: null, completed_normally: false, empty_sse: false,
    error_message: reason, body_preview: reason, chat_session_id: null,
  }
}

function estimateThreshold(outcomes: ReadonlyArray<CifThresholdProbeOutcome>): number | null {
  let lastGood = -1
  let firstBad = -1
  for (const o of outcomes) {
    if (o.completed_normally) lastGood = Math.max(lastGood, o.size_chars)
    else if (firstBad === -1 || o.size_chars < firstBad) firstBad = o.size_chars
  }
  if (lastGood < 0 || firstBad < 0) return null
  if (firstBad <= lastGood) return null
  return Math.floor((lastGood + firstBad) / 2)
}

function findFirstBehaviorChange(outcomes: ReadonlyArray<CifThresholdProbeOutcome>): number | null {
  const sorted = [...outcomes].sort((a, b) => a.size_chars - b.size_chars)
  let prevGood = false
  for (const o of sorted) {
    if (prevGood && !o.completed_normally) return o.size_chars
    if (o.completed_normally) prevGood = true
  }
  return null
}
