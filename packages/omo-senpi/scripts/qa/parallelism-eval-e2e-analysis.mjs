export const EXPECTED_PARALLELISM_PROPERTY_KEYS = Object.freeze([
  "$geoip_disable",
  "$lib",
  "$lib_version",
  "$process_person_profile",
  "$session_id",
  "clock_anomalies",
  "dropped_calls",
  "eval_execution_detached_count",
  "eval_execution_event_bus_available",
  "eval_execution_event_count",
  "eval_execution_event_rejected_count",
  "eval_execution_ok_count",
  "eval_nested_tool_call_count",
  "eval_nested_tool_call_error_count",
  "eval_nested_tool_call_ok_count",
  "eval_nested_tool_call_pending_count",
  "eval_only_duration_ms",
  "eval_only_waves",
  "eval_outer_joined_calls",
  "eval_tool_aggregate_truncated_execution_count",
  "incomplete_calls",
  "measured_eval_execution_duration_ms_sum",
  "measured_eval_nested_tool_duration_ms_sum",
  "measured_turn_duration_ms_total",
  "mixed_non_eval_joined_calls",
  "mixed_waves",
  "modeled_wallclock_saved_ms",
  "non_eval_joined_calls",
  "non_eval_saved_round_trips",
  "non_eval_wave_size_histogram",
  "non_eval_waves_multi",
  "non_eval_waves_total",
  "package_version",
  "platform",
  "product_name",
  "schema_kind",
  "schema_version",
  "upper_bound_saved_ms",
])

export function analyzeParallelismRequests(requests) {
  const captures = requests.flatMap((request) =>
    Array.isArray(request.body?.batch) ? request.body.batch : [])
  const summaries = captures.filter((capture) => capture?.event === "parallelism_summary")
  const properties = isRecord(summaries[0]?.properties) ? summaries[0].properties : {}
  const actualKeys = Object.keys(properties).sort()
  const expectedKeys = [...EXPECTED_PARALLELISM_PROPERTY_KEYS].sort()
  return {
    exactlyOneSummary: summaries.length === 1,
    fixedAllowlistedKeysOnly: JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    fixedScalarValuesOnly: Object.values(properties).every(isScalar),
    schemaKindV2: properties.schema_kind === "parallelism_v2",
    eventBusObserved: properties.eval_execution_event_bus_available === true,
    nestedCountsExact:
      properties.eval_execution_event_count === 1
      && properties.eval_execution_event_rejected_count === 0
      && properties.eval_execution_ok_count === 1
      && properties.eval_nested_tool_call_count === 2
      && properties.eval_nested_tool_call_ok_count === 2
      && properties.eval_nested_tool_call_error_count === 0
      && properties.eval_nested_tool_call_pending_count === 0,
    outerEvalExcludedFromNonEval:
      properties.eval_outer_joined_calls === 1
      && properties.eval_only_waves === 1
      && properties.non_eval_joined_calls === 0
      && properties.non_eval_saved_round_trips === 0
      && properties.modeled_wallclock_saved_ms === 0
      && properties.upper_bound_saved_ms === 0,
    localhostOnlyTelemetry: requests.every((request) => isLoopback(request.remoteAddress)),
  }
}

export function verdict(checks) {
  const failed = Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name)
  return { result: failed.length === 0 ? "PASS" : "FAIL", failed }
}

function isScalar(value) {
  return value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
}

function isLoopback(value) {
  return value === "127.0.0.1"
    || value === "::1"
    || value === "::ffff:127.0.0.1"
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
