/**
 * Conservative rate-limit defaults for the chat.deepseek.com OpenAI-compatible adapter.
 * Source: V0.3 live calibration (run cal-1778194819085-zmdu62, 2026-05-07) + Oracle gate verdict.
 *
 * These constants are READ-ONLY at build time. V0.7 (account pool) will consume them.
 * V0.5 (single-call executor) does NOT throttle yet, it just dispatches one call at a time.
 */
export const RATE_DEFAULTS = {
  /** Sustained requests per minute per account. V0.3 observed >=12 rpm clean; conservative floor. */
  SUSTAINED_RPM_PER_ACCOUNT: 10,
  /** Hard burst / inflight concurrency cap per account. Oracle-tightened from Junior's 3 to 2. */
  BURST_INFLIGHT_CAP_PER_ACCOUNT: 2,
  /** Experimental upper burst (canary only, must trigger immediate backoff on truncation). */
  BURST_EXPERIMENTAL_CAP: 3,
  /** Default account pool size to sustain 60 rpm aggregate (= ceil(60/10) * 1.5). */
  POOL_SIZE_FOR_60_RPM_AGGREGATE: 9,
  /** Cooldown after burst or truncation event, milliseconds. */
  COOLDOWN_AFTER_BURST_MS: 10_000,
  /** Mute-watcher polling interval during normal operation, milliseconds. */
  MUTE_WATCHER_NORMAL_MS: 30_000,
  /** Mute-watcher polling interval during high-aggression / manual calibration runs. */
  MUTE_WATCHER_HIGH_AGGRESSION_MS: 10_000,
  /** No hard per-request token cap observed up to 50k chars in V0.3. Informational only. */
  TOKEN_NO_HARD_CAP_OBSERVED_CHARS: 50_000,
} as const

/** Stream-truncation detection criteria from V0.3 finding (NEW signal class). */
export const STREAM_TRUNCATION_DETECTOR = {
  /** Required: HTTP 200 status. */
  expected_status: 200,
  /** Required: SSE never reached terminal_status=FINISHED. */
  requires_no_terminal_finished: true,
  /** Required: empty_sse must be false (else it's the empty-SSE signal class). */
  requires_non_empty_sse: true,
  /** Severity evidence (NOT classification criterion): unusually low total_ms. */
  severity_low_total_ms_threshold: 1_000,
  /** Severity evidence: total_ms below this fraction of recent normal latency. */
  severity_low_latency_fraction: 0.5,
} as const

/** Default port range start for the OpenAI-compat server. */
export const DEFAULT_OPENAI_COMPAT_PORT_START = 38_000

/** Default host (bound to loopback for safety). */
export const DEFAULT_OPENAI_COMPAT_HOST = "127.0.0.1"

/** V0.10.3: SUPPORTED_MODELS re-exported from model-capability-resolver to keep the SKU list in one place. */
export { SUPPORTED_MODEL_IDS as SUPPORTED_MODELS } from "./model-capability-resolver"

/** Owner field returned in /v1/models responses. */
export const MODEL_OWNED_BY = "deepseek"
