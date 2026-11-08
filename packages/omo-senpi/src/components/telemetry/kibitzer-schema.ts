const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

/**
 * Privacy schema for `kibitzer_summary`: counts, durations and a masked model id only. Nudge paths
 * and hints never appear - they are user-authored text from a private memory corpus.
 */
export const KIBITZER_SUMMARY_SCHEMA = Object.freeze({
  "$session_id": STRING_PROPERTY,
  buffered_cooldown: NUMBER_PROPERTY,
  buffered_no_new_candidate: NUMBER_PROPERTY,
  cache_read_tokens: NUMBER_PROPERTY,
  cache_write_tokens: NUMBER_PROPERTY,
  candidates_total: NUMBER_PROPERTY,
  first_nudge_wake: NUMBER_PROPERTY,
  generations: NUMBER_PROPERTY,
  input_tokens: NUMBER_PROPERTY,
  model_top: STRING_PROPERTY,
  nudge_gap_ms_median: NUMBER_PROPERTY,
  nudge_gap_ms_p90: NUMBER_PROPERTY,
  nudges_delivered: NUMBER_PROPERTY,
  offers_total: NUMBER_PROPERTY,
  output_tokens: NUMBER_PROPERTY,
  slot_wait_ms_total: NUMBER_PROPERTY,
  tool_calls_total: NUMBER_PROPERTY,
  wake_duration_ms_total: NUMBER_PROPERTY,
  wake_span_ms: NUMBER_PROPERTY,
  wakes_deadline: NUMBER_PROPERTY,
  wakes_failed: NUMBER_PROPERTY,
  wakes_tool_budget: NUMBER_PROPERTY,
  wakes_total: NUMBER_PROPERTY,
  wakes_with_nudge: NUMBER_PROPERTY,
})
