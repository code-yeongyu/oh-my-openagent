import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"
import { CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task/agents-builtin"
import type { ResolvedModelRecord, TaskRecord, TaskRunStats } from "@oh-my-opencode/senpi-task"

import type { TaskTerminalEdge } from "../task/terminal-observers"
import { DELEGATION_REASONING_EFFORTS, DELEGATION_START_REASONS } from "./delegation-schema"
import { maskProviderAndModel } from "./product-identity"

export type DelegationStartReason = (typeof DELEGATION_START_REASONS)[number]

export type DelegationSteerCounts = {
  readonly running: number
  readonly queued: number
}

export type DelegationProjectionInput = {
  readonly edge: TaskTerminalEdge
  readonly sessionHash: string
  readonly startReason: DelegationStartReason
  readonly steerCounts: DelegationSteerCounts
}

/** Scalar property bag, exactly the shape the capture wrapper forwards to the transport. */
export type DelegationProperties = Readonly<Record<string, string | number | boolean>>

const BUILTIN_CATEGORY_NAMES: ReadonlySet<string> = new Set(BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => name))
const REASONING_EFFORTS: ReadonlySet<string> = new Set(DELEGATION_REASONING_EFFORTS)

/**
 * Project one terminal task record into the `delegation_completed` property set.
 *
 * This is an explicit scalar ALLOWLIST, not a filtered copy: every free-text field a record can carry
 * (`final_response`, `error_message`, `name`, `description`, `task_summary`, the spawn spec's prompt
 * and cwd) is excluded by construction rather than by a suffix rule, and the exact-key-set test in
 * `delegation-projection.test.ts` is what keeps it that way. Pure: no I/O, no clock, no registry.
 */
export function projectDelegationCompleted(input: DelegationProjectionInput): DelegationProperties {
  const { record } = input.edge
  const masked = maskProviderAndModel(record.resolved_model?.provider ?? "", record.resolved_model?.model_id ?? "")
  const duration = durationOf(record)
  const stats = record.run_stats
  return {
    $session_id: input.sessionHash,
    task_seq: finiteCount(record.task_seq),
    run_epoch: finiteCount(record.notification.run_epoch),
    status: record.status,
    start_reason: input.startReason,
    category: closedName(record.category, BUILTIN_CATEGORY_NAMES),
    agent_type: closedName(record.agent_type, CURATED_READONLY_AGENT_NAMES),
    owner_kind: ownerKindOf(record),
    background_mode: record.background_mode ?? "unknown",
    execution_mode: record.execution_mode === "process" ? "process" : "in-process",
    provider: masked.provider,
    model_id: masked.model_id,
    reasoning_effort: reasoningEffortOf(record.resolved_model),
    model_source: record.resolved_model?.source ?? "none",
    fallback_attempts: finiteCount(record.fallback_attempts?.length),
    config_generation: finiteCount(record.config_generation),
    duration_ms: duration.ms,
    duration_status: duration.status,
    turns: finiteCount(stats?.turns),
    tool_calls: finiteCount(stats?.tool_calls),
    ...tokenTotals(stats),
    token_status: stats?.token_status ?? "unavailable",
    ...(costOf(stats)),
    stats_status: statsStatusOf(record),
    task_send_running_count: finiteCount(input.steerCounts.running),
    task_send_queued_count: finiteCount(input.steerCounts.queued),
  }
}

// A token total is omitted when the provider never reported it: `token_status` says whether the
// absence is coverage or a genuine zero, and a `sum()` over omitted fields must not read as zero.
function tokenTotals(stats: TaskRunStats | undefined): DelegationProperties {
  if (stats === undefined) return {}
  return {
    ...optionalTotal("input_tokens", stats.input_tokens),
    ...optionalTotal("output_tokens", stats.output_tokens),
    ...optionalTotal("cache_read_tokens", stats.cache_read_tokens),
    ...optionalTotal("cache_write_tokens", stats.cache_write_tokens),
    ...optionalTotal("total_tokens", stats.total_tokens),
  }
}

function optionalTotal(key: string, value: number | undefined): DelegationProperties {
  return value === undefined || !Number.isFinite(value) || value < 0 ? {} : { [key]: value }
}

// A reported zero cost is a fact; an absent cost is not a zero. `cost_usd` therefore ships only
// alongside `cost_status: "reported"`, and a non-finite figure degrades to `invalid`.
function costOf(stats: TaskRunStats | undefined): DelegationProperties {
  const status = stats?.cost_status ?? "unavailable"
  const cost = stats?.cost_usd
  if (status !== "reported") return { cost_status: status }
  if (cost === undefined || !Number.isFinite(cost) || cost < 0) return { cost_status: "invalid" }
  return { cost_status: "reported", cost_usd: cost }
}

// The tracker measures active execution time; a reconciled record has only its timestamps, and a
// suspended or backwards wall clock is reported as unavailable rather than as active duration.
function durationOf(record: TaskRecord): { readonly ms: number; readonly status: string } {
  const measured = record.run_stats?.runtime_ms
  if (record.run_stats?.duration_status === "monotonic" && measured !== undefined && Number.isFinite(measured)) {
    return { ms: Math.max(0, measured), status: "monotonic" }
  }
  const elapsed = Date.parse(record.updated_at) - Date.parse(record.created_at)
  if (!Number.isFinite(elapsed) || elapsed < 0) return { ms: 0, status: "unavailable" }
  return { ms: elapsed, status: "wall_clock" }
}

// Crash and reconciliation rows would otherwise bias every efficiency aggregate silently: no stats at
// all is `unavailable`, stats that the tracker could not vouch for are `partial`.
function statsStatusOf(record: TaskRecord): string {
  const stats = record.run_stats
  if (stats === undefined) return "unavailable"
  if (stats.token_status === "complete" && stats.duration_status === "monotonic") return "complete"
  return "partial"
}

function ownerKindOf(record: TaskRecord): string {
  if (record.owner?.kind === "dag") return "dag_node"
  const spec = record.spawn_spec
  if (spec === undefined) return "unknown"
  if ("member_scoped_tool_names" in spec && spec.member_scoped_tool_names !== undefined) return "team_member"
  if ("member_env" in spec && spec.member_env !== undefined) return "team_member"
  return "plain_child"
}

// Unified reasoning level, then the legacy persisted spelling, then the variant mirror. A
// harness-native preset is real but unbounded, so it exports as `other`; absent exports as `none`.
function reasoningEffortOf(model: ResolvedModelRecord | undefined): string {
  const level = model?.reasoning ?? model?.reasoning_effort ?? model?.variant
  if (level === undefined) return "none"
  return REASONING_EFFORTS.has(level) ? level : "other"
}

// User-authored category and agent names are free text: only membership in the shipped vocabulary
// leaves the machine, everything else is `custom`, and an absent target is `none`.
function closedName(value: string | undefined, known: ReadonlySet<string>): string {
  if (value === undefined || value.length === 0) return "none"
  return known.has(value) ? value : "custom"
}

function finiteCount(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value < 0 ? 0 : value
}
