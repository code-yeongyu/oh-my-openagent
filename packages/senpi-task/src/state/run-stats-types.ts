export const TOKEN_COVERAGE_STATUSES = ["complete", "partial", "unavailable"] as const

export type TokenCoverageStatus = (typeof TOKEN_COVERAGE_STATUSES)[number]

export const COST_REPORT_STATUSES = ["reported", "unavailable", "invalid"] as const

export type CostReportStatus = (typeof COST_REPORT_STATUSES)[number]

export const DURATION_SOURCE_STATUSES = ["monotonic", "wall_clock", "unavailable"] as const

export type DurationSourceStatus = (typeof DURATION_SOURCE_STATUSES)[number]

// Usage/runtime facts accumulated over ONE run of the child (spawn to terminal transition).
// total_tokens sums usage.totalTokens across assistant turns (billed volume: context re-sent
// per turn counts every time); output_tokens sums completion tokens only. generation_ms sums
// assistant streaming windows. tokens_per_second is emitted ONLY when every token-bearing
// generation window has a non-zero measured duration; when any token-bearing window collapsed
// to zero (post-hoc RPC burst, clock coalescing), the lost timing makes generation throughput
// unverifiable and the field is omitted rather than reporting a runtime-derived substitute.
export type TaskRunStats = {
  readonly runtime_ms: number
  readonly turns: number
  /** Count of assistant turns that ended in error or abort: a failed turn is not a `turn` and
   * contributes no tokens, cost or generation time. Emitted only when greater than zero. */
  readonly failed_turns?: number
  readonly tool_calls: number
  readonly output_tokens?: number
  /** Summed prompt tokens the provider billed as fresh (cache reads/writes are counted separately). */
  readonly input_tokens?: number
  /** Summed tokens served from the provider's prompt cache over the run. */
  readonly cache_read_tokens?: number
  /** Summed tokens the provider wrote into its prompt cache over the run. */
  readonly cache_write_tokens?: number
  readonly total_tokens?: number
  readonly generation_ms?: number
  readonly tokens_per_second?: number
  /** Summed provider-reported spend for the run, in USD. */
  readonly cost_usd?: number
  /** cacheRead / (input + cacheRead + cacheWrite) for the latest assistant request with a nonzero
   * denominator, as a 0..1 fraction. Running status surfaces use this to match Senpi's footer. */
  readonly cache_hit_rate_last?: number
  /** Sum(cacheRead) / Sum(input + cacheRead + cacheWrite) over the whole run, as a 0..1 fraction.
   * Completed-run summaries use this aggregate. Omitted when no turn reported a denominator. */
  readonly cache_hit_rate_run?: number
  /** Usage coverage of the token totals: every assistant turn reported usage, only some did, or none. */
  readonly token_status?: TokenCoverageStatus
  /** Whether `cost_usd` is a provider-reported figure; a missing cost is never a zero cost. */
  readonly cost_status?: CostReportStatus
  /** Provenance of `runtime_ms`: measured by the live tracker, or reconstructed from record timestamps. */
  readonly duration_status?: DurationSourceStatus
}
