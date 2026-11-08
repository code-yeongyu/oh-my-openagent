// Event names from collector pin 13c6e61b40c4. Kept outside the exporter projection
// so a legacy-only component can reject its event without loading the sidecar.
const OTLP_EVENTS = [
  "category_config", "computer_use_activation", "computer_use_engine_error",
  "computer_use_permission_denied", "daily_active", "delegation_completed",
  "delegation_started", "feature_used", "handoff_hint", "kibitzer_summary",
  "parallelism_summary", "process_crashed", "prompt_submitted", "session_started",
  "session_summary", "skill_loaded", "turn_completed",
] as const

export type OtlpEvent = (typeof OTLP_EVENTS)[number]

export function isOtlpEvent(event: string): event is OtlpEvent {
  return OTLP_EVENTS.some(name => name === event)
}
