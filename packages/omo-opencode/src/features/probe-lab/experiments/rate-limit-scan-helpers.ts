import type { ProbeLabContext } from "../probe-lab-context"
import type { ProbeProvider } from "../providers/provider-types"
import type { CifChatSessionFactory } from "./cif-threshold-experiment"
import type {
  MuteState,
  RateMuteEvent,
  RateProbeOutcome,
  RateScanInput,
  RateScanMode,
  RateScanResult,
  RateScanSummary,
  RecoverySample,
} from "./rate-limit-types"

export type RateScanRuntimeOpts = {
  chatSessionFactory?: CifChatSessionFactory
  sleep?: (ms: number) => Promise<void>
  base_url_override?: string
  provider_override?: ProbeProvider
  now?: () => number
}

export type ResolvedRuntime = {
  provider: ProbeProvider
  baseUrl: string
  sleep: (ms: number) => Promise<void>
  now: () => number
  factory?: CifChatSessionFactory
}

export const DEFAULT_MUTE_INTERVAL_MS = 30_000

export function resolveRuntime(
  ctx: ProbeLabContext,
  input: RateScanInput,
  opts?: RateScanRuntimeOpts,
): ResolvedRuntime {
  let provider: ProbeProvider | null = opts?.provider_override ?? null
  if (!provider) {
    ctx.providerRegistry.loadAll()
    provider = ctx.providerRegistry.get(input.provider_id)
  }
  if (!provider) throw new Error(`provider not found: ${input.provider_id}`)
  const creds = ctx.store.getProvider(input.provider_id)
  if (!creds && !opts?.base_url_override) {
    throw new Error(`provider credentials not found: ${input.provider_id}`)
  }
  const baseUrl = opts?.base_url_override ?? creds!.base_url
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = opts?.now ?? (() => Date.now())
  return { provider, baseUrl, sleep, now, factory: opts?.chatSessionFactory }
}

export function requireConfig<T>(value: T | undefined, mode: string): T {
  if (!value) throw new Error(`rate-limit scan: missing ${mode} config`)
  return value
}

export function isLikelyMuteOutcome(o: RateProbeOutcome): boolean {
  if (o.status === 429) return true
  if (o.status === 200 && o.empty_sse) return true
  return false
}

export function makeMuteEventFromOutcome(o: RateProbeOutcome, now: number): RateMuteEvent {
  return {
    triggered_at: now,
    mute_until_reported: null,
    trigger_status: o.status,
    trigger_body_preview: o.error_message ?? "empty_sse_or_429",
  }
}

export function makeMuteEventFromMuteState(state: MuteState): RateMuteEvent {
  return {
    triggered_at: state.sampled_at,
    mute_until_reported: state.mute_until,
    trigger_status: state.raw_status,
    trigger_body_preview: state.raw_body_preview,
  }
}

export function finalize(
  mode: RateScanMode,
  outcomes: RateProbeOutcome[],
  muteSamples: MuteState[],
  muteEvent: RateMuteEvent | null,
  recoverySamples: RecoverySample[],
  aborted: boolean,
  abortReason: string | null,
  elapsedMs: number,
): RateScanResult {
  return {
    mode,
    exchange_ids: outcomes.filter((o) => o.exchange_id > 0).map((o) => o.exchange_id),
    outcomes,
    mute_samples: muteSamples,
    mute_event: muteEvent,
    recovery_samples: recoverySamples,
    aborted,
    abort_reason: abortReason,
    summary: summarize(outcomes, elapsedMs),
  }
}

function summarize(outcomes: RateProbeOutcome[], elapsedMs: number): RateScanSummary {
  const succeeded = outcomes.filter((o) => o.completed_normally).length
  const failed = outcomes.filter((o) => !o.completed_normally).length
  const empty = outcomes.filter((o) => o.empty_sse).length
  const ttfts = outcomes.map((o) => o.ttft_ms).filter((x): x is number => x != null)
  const avg = ttfts.length === 0 ? null : Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length)
  return {
    total_probes: outcomes.length,
    succeeded,
    failed_or_blocked: failed,
    empty_sse: empty,
    average_ttft_ms: avg,
    elapsed_ms: elapsedMs,
  }
}
