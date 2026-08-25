const BOOLEAN_PROPERTY = Object.freeze({ type: "boolean" } as const)
const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

function enumProperty<const Values extends readonly string[]>(values: Values): Readonly<{
  type: "string"
  values: Values
}> {
  return Object.freeze({ type: "string", values: Object.freeze(values) })
}

export const PARALLELISM_SUMMARY_SCHEMA = Object.freeze({
  "$session_id": STRING_PROPERTY,
  clock_anomalies: NUMBER_PROPERTY,
  dropped_calls: NUMBER_PROPERTY,
  eval_execution_detached_count: NUMBER_PROPERTY,
  eval_execution_event_bus_available: BOOLEAN_PROPERTY,
  eval_execution_event_count: NUMBER_PROPERTY,
  eval_execution_event_rejected_count: NUMBER_PROPERTY,
  eval_execution_ok_count: NUMBER_PROPERTY,
  eval_cells_with_nested_count: NUMBER_PROPERTY,
  eval_saved_prefix_tokens: NUMBER_PROPERTY,
  eval_nested_tool_call_count: NUMBER_PROPERTY,
  eval_nested_tool_call_error_count: NUMBER_PROPERTY,
  eval_nested_tool_call_ok_count: NUMBER_PROPERTY,
  eval_nested_tool_call_pending_count: NUMBER_PROPERTY,
  eval_only_duration_ms: NUMBER_PROPERTY,
  eval_only_waves: NUMBER_PROPERTY,
  eval_outer_joined_calls: NUMBER_PROPERTY,
  eval_tool_aggregate_truncated_execution_count: NUMBER_PROPERTY,
  incomplete_calls: NUMBER_PROPERTY,
  measured_eval_execution_duration_ms_sum: NUMBER_PROPERTY,
  measured_eval_nested_tool_duration_ms_sum: NUMBER_PROPERTY,
  measured_turn_duration_ms_total: NUMBER_PROPERTY,
  mixed_non_eval_joined_calls: NUMBER_PROPERTY,
  mixed_waves: NUMBER_PROPERTY,
  modeled_wallclock_saved_ms: NUMBER_PROPERTY,
  non_eval_joined_calls: NUMBER_PROPERTY,
  non_eval_saved_prefix_tokens: NUMBER_PROPERTY,
  non_eval_saved_round_trips: NUMBER_PROPERTY,
  non_eval_wave_size_histogram: STRING_PROPERTY,
  non_eval_waves_multi: NUMBER_PROPERTY,
  non_eval_waves_total: NUMBER_PROPERTY,
  schema_kind: enumProperty(["parallelism_v1", "parallelism_v2", "parallelism_v3"] as const),
  upper_bound_saved_ms: NUMBER_PROPERTY,
  current_prefix_tokens: NUMBER_PROPERTY,
})
