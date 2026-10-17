import type { ResolvedChildPlan, ManagerStartSpec } from "../manager/types"

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
export type PoolId = `wp_${string}`
export type ItemId = `wi_${string}`
export type WorkpoolMode = "fresh" | "keep_alive"
export type WorkpoolAgent = { readonly prompt: string; readonly model?: string } & (
  | { readonly category: string; readonly subagent_type?: never }
  | { readonly subagent_type: string; readonly category?: never }
)
export type WorkpoolCreate = { readonly name: string; readonly agent: WorkpoolAgent; readonly mode?: WorkpoolMode; readonly tools?: readonly string[] }
export type WorkpoolCaller = { readonly sessionId: string; readonly rootSessionId: string; readonly depth: number; readonly cwd: string }
export type WorkpoolInput = { readonly key: string; readonly input: Json }
export type WorkpoolYield = { readonly key: string } & (
  | { readonly data: Json; readonly error?: never }
  | { readonly error: { readonly code: string; readonly message: string }; readonly data?: never }
)
export const WORKPOOL_ERROR_CODES = [
  "invalid_input", "invalid_pool_id", "pool_not_found", "scope_denied", "pool_name_conflict", "pool_closed",
  "duplicate_key_conflict", "tools_unavailable", "admission_refused", "spawn_failed", "policy_denied",
  "worker_not_continuable", "worker_unassigned", "stale_assignment", "yield_unavailable", "store_corrupt", "cancelled",
  "yield_conflict", "item_missing_yield", "delivery_uncertain", "cwd_unavailable", "config_generation_mismatch",
  "reserved_tool_name", "tool_name_collision", "kernel_tool_missing", "kernel_tool_stale",
] as const
export type WorkpoolErrorCode = typeof WORKPOOL_ERROR_CODES[number]
export class WorkpoolError extends Error {
  override readonly name = "WorkpoolError"
  constructor(readonly code: WorkpoolErrorCode, message: string) { super(message) }
}
export type WorkpoolItem = WorkpoolInput & {
  readonly item_id: ItemId
  readonly status: "queued" | "assigned" | "completed" | "error" | "cancelled"
  readonly binding?: { readonly task_id: string; readonly run_epoch: number; readonly generation: number }
  readonly delivery?: { readonly phase: "queued" | "dispatching" | "acknowledged"; readonly message_sha256?: string }
  readonly data?: Json
  readonly error?: { readonly code: string; readonly message: string }
  readonly yield_sha256?: string
}
export type WorkpoolWorker = {
  readonly task_id: string
  readonly run_epoch: number
  readonly status: "busy" | "idle"
  readonly completed_turns: number
  readonly idle_since: number
}
export type WorkpoolSpec = {
  readonly start: ManagerStartSpec
  readonly plan: ResolvedChildPlan
}
export type WorkpoolRecord = {
  readonly version: 1
  readonly pool_id: PoolId
  readonly name: string
  readonly parent_session_id: string
  readonly root_session_id: string
  readonly generation: number
  readonly revision: number
  readonly mode: WorkpoolMode
  readonly agent: WorkpoolAgent
  readonly worker_spec: WorkpoolSpec
  readonly status: "open" | "closing" | "cancelled"
  // Parent kernel-tool names requested at create. Plain data: the live capability and its fenced
  // descriptors are never persisted and are re-resolved at every NEW worker spawn.
  readonly kernel_tool_names?: readonly string[]
  readonly items: readonly WorkpoolItem[]
  readonly workers: readonly WorkpoolWorker[]
  readonly aggregate?: { readonly generation: number; readonly delivered: boolean; readonly accepted?: boolean }
}
export type WorkpoolEvent = {
  readonly pool_id: PoolId
  readonly kind: "queued" | "waiting" | "granted" | "dispatched" | "admission_failed" | "cancelled" | "worker_idle" | "item_result" | "aggregate_failed"
  readonly item_id?: ItemId
  readonly task_id?: string
  readonly run_epoch?: number
  readonly error?: { readonly code: WorkpoolErrorCode; readonly message: string }
}
