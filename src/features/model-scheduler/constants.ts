export const MODEL_HEALTH_FILE = "model-health.json"
export const MODEL_SCHEDULER_AUDIT_FILE = "scheduler-audit.jsonl"
export const MODEL_ROUTING_FILE = "model-routing.json"

export const DEFAULT_MODEL_SCHEDULER_CONFIG = {
  enabled: true,
  interval_minutes: 60,
  mode: "active",
  preflight_on_session_created: true,
  failure_threshold: 1,
  recovery_threshold: 1,
  agent_cooldown_minutes: 180,
  protect_manual_routing: true,
  probe_enabled: true,
  probe_timeout_ms: 15000,
  probe_max_latency_ms: 8000,
} as const
