import { CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task/agents-builtin"
import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"

const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

function enumProperty<const Values extends readonly string[]>(values: Values): Readonly<{
  type: "string"
  values: Values
}> {
  return Object.freeze({ type: "string", values: Object.freeze(values) })
}

/** Terminal statuses a task record can reach; mirrors senpi-task `TERMINAL_STATUSES`. */
export const DELEGATION_STATUSES = ["completed", "error", "cancelled", "interrupted", "lost"] as const

/**
 * Why THIS run of a logical task started. One closed vocabulary instead of a prior-status field plus
 * a revive counter: it is the only form that also names a dag retry, a session resume and a runtime
 * fallback, which a bare "was revived" boolean leaves indistinguishable from a fresh spawn. Only
 * `revive_after_completed` is a re-query; every other `revive_after_*` is recovery.
 */
export const DELEGATION_START_REASONS = [
  "initial_spawn",
  "runtime_fallback",
  "session_resume",
  "dag_retry",
  "revive_after_completed",
  "revive_after_error",
  "revive_after_cancelled",
  "revive_after_interrupted",
  "revive_after_lost",
  "unknown",
] as const

/** Who owns the task. DAG retries and team traffic otherwise inflate user-delegation denominators. */
export const DELEGATION_OWNER_KINDS = ["plain_child", "dag_node", "team_member", "unknown"] as const

/** `notify_on_terminal` alone cannot separate a promoted foreground task from a spawned background one. */
export const DELEGATION_BACKGROUND_MODES = ["foreground", "background", "promoted", "unknown"] as const

/** Canonical reasoning levels; harness-native presets collapse to `other`, absent reads `none`. */
export const DELEGATION_REASONING_EFFORTS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max", "other", "none",
] as const

export const DELEGATION_MODEL_SOURCES = ["category", "explicit", "agent", "none"] as const

/** Data-quality vocabularies: a missing measurement is never a zero measurement. */
export const DELEGATION_COVERAGE_STATUSES = ["complete", "partial", "unavailable"] as const
export const DELEGATION_COST_STATUSES = ["reported", "unavailable", "invalid"] as const
export const DELEGATION_DURATION_STATUSES = ["monotonic", "wall_clock", "unavailable"] as const

const BUILTIN_CATEGORY_NAMES = BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => name)

/**
 * `delegation_completed`: one row per terminal edge of one run of one delegated task. Every string is
 * a closed enum or the salted session hash, every number is a finite non-negative scalar, and the
 * projection that fills it is an explicit allowlist - no free text can reach this event.
 *
 * The provider and model vocabularies are passed in rather than imported: they live next to
 * `maskProviderAndModel` in `product-identity.ts`, which owns this schema.
 */
export function buildDelegationCompletedSchema(masked: {
  readonly providers: readonly string[]
  readonly models: readonly string[]
}) {
  return Object.freeze({
    "$session_id": STRING_PROPERTY,
    agent_type: enumProperty([...CURATED_READONLY_AGENT_NAMES, "custom", "none"] as const),
    background_mode: enumProperty(DELEGATION_BACKGROUND_MODES),
    cache_read_tokens: NUMBER_PROPERTY,
    cache_write_tokens: NUMBER_PROPERTY,
    category: enumProperty([...BUILTIN_CATEGORY_NAMES, "custom", "none"] as const),
    config_generation: NUMBER_PROPERTY,
    cost_status: enumProperty(DELEGATION_COST_STATUSES),
    cost_usd: NUMBER_PROPERTY,
    duration_ms: NUMBER_PROPERTY,
    duration_status: enumProperty(DELEGATION_DURATION_STATUSES),
    execution_mode: enumProperty(["in-process", "process"] as const),
    fallback_attempts: NUMBER_PROPERTY,
    input_tokens: NUMBER_PROPERTY,
    model_id: enumProperty(masked.models),
    model_source: enumProperty(DELEGATION_MODEL_SOURCES),
    output_tokens: NUMBER_PROPERTY,
    owner_kind: enumProperty(DELEGATION_OWNER_KINDS),
    provider: enumProperty(masked.providers),
    reasoning_effort: enumProperty(DELEGATION_REASONING_EFFORTS),
    run_epoch: NUMBER_PROPERTY,
    start_reason: enumProperty(DELEGATION_START_REASONS),
    stats_status: enumProperty(DELEGATION_COVERAGE_STATUSES),
    status: enumProperty(DELEGATION_STATUSES),
    task_send_queued_count: NUMBER_PROPERTY,
    task_send_running_count: NUMBER_PROPERTY,
    task_seq: NUMBER_PROPERTY,
    token_status: enumProperty(DELEGATION_COVERAGE_STATUSES),
    tool_calls: NUMBER_PROPERTY,
    total_tokens: NUMBER_PROPERTY,
    turns: NUMBER_PROPERTY,
  })
}
