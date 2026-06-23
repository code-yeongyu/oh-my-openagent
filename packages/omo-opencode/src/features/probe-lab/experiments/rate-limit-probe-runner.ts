import { randomUUID } from "node:crypto"
import type { ProbeLabContext } from "../probe-lab-context"
import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"
import { buildSizedPrompt } from "./cif-threshold-prompt-builder"
import { extractCifSseSignals } from "./cif-threshold-signal-extractor"
import {
  defaultChatSessionFactory,
  type CifChatSessionFactory,
} from "./cif-threshold-experiment"
import type { RateProbeOutcome } from "./rate-limit-types"

const COMPLETION_PATH = "/api/v0/chat/completion"
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_PROMPT_CHARS = 100

export type RateProbeArgs = {
  ctx: ProbeLabContext
  provider: ProbeProvider
  baseUrl: string
  hypothesisId: string
  index: number
  promptChars: number
  promptTemplate?: string
  sessionLabel: string
  chatSessionFactory?: CifChatSessionFactory
}

export async function runRateProbe(args: RateProbeArgs): Promise<RateProbeOutcome> {
  const factory = args.chatSessionFactory ?? defaultChatSessionFactory
  const startedAt = Date.now()
  const session = await factory(args.provider, args.baseUrl)
  if (!session.session_id) {
    return makeAbortedOutcome(args.index, args.promptChars, startedAt, "session_create_failed")
  }
  const promptChars = args.promptChars > 0 ? args.promptChars : DEFAULT_PROMPT_CHARS
  const prompt = buildSizedPrompt(promptChars, args.promptTemplate)
  const url = `${args.baseUrl.replace(/\/$/, "")}${COMPLETION_PATH}`
  const body = JSON.stringify({
    chat_session_id: session.session_id,
    parent_message_id: null,
    prompt,
    ref_file_ids: [],
    thinking_enabled: false,
    search_enabled: false,
  })
  const labSession = args.ctx.store.insertSession({
    id: `sess-${randomUUID()}`,
    hypothesis_id: args.hypothesisId,
    identity_id: null,
    provider_id: args.provider.id,
    config: { label: args.sessionLabel, prompt_chars: promptChars, index: args.index },
  })
  const req: ProbeRequest = {
    url,
    method: "POST",
    headers: {},
    body,
    timeout_ms: DEFAULT_TIMEOUT_MS,
    forward_as_is: false,
    metadata: {
      session_id: labSession.id,
      hypothesis_id: args.hypothesisId,
      exchange_sequence: 1,
    },
  }
  const dispatchT0 = Date.now()
  const res = await args.provider.dispatchProbe(req)
  const elapsed = Date.now() - dispatchT0
  const signals = extractCifSseSignals(res.body)
  const exchange = args.ctx.store.insertExchange({
    session_id: labSession.id,
    method: "POST",
    url,
    request_headers: req.headers,
    request_body: body,
    response_status: res.status,
    response_headers: res.headers,
    response_body: res.body,
    timing_total_ms: res.timing.total_ms ?? elapsed,
    was_forwarded_as_is: false,
  })
  const completedNormally = res.status === 200 && signals.terminal_status === "FINISHED"
  return {
    index: args.index,
    exchange_id: exchange.id,
    status: res.status,
    ttft_ms: res.timing.first_byte_ms ?? null,
    total_ms: res.timing.total_ms ?? elapsed,
    prompt_chars: promptChars,
    empty_sse: signals.empty_sse && res.status === 200,
    terminal_status: signals.terminal_status,
    completed_normally: completedNormally,
    error_message: res.error?.message ?? null,
    started_at: startedAt,
    chat_session_id: session.session_id,
  }
}

function makeAbortedOutcome(index: number, promptChars: number, startedAt: number, reason: string): RateProbeOutcome {
  return {
    index,
    exchange_id: -1,
    status: -1,
    ttft_ms: null,
    total_ms: 0,
    prompt_chars: promptChars,
    empty_sse: false,
    terminal_status: null,
    completed_normally: false,
    error_message: reason,
    started_at: startedAt,
    chat_session_id: null,
  }
}
