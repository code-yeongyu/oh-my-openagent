import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { ResolvedModelRecord, TaskRecord, TaskRunStats, TaskStatus } from "../state"
import type {
  CancelOutcome,
  DestructionPort,
  InterruptOutcome,
  SendInput,
  SendOutcome,
} from "../steering"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle, ManagedChildListener } from "./child-handle"
import type { ExecutionMode } from "./execution-mode"

export type { ExecutionMode } from "./execution-mode"

// The unified spec both runner adapters accept. A superset: the rpc adapter uses the subset it
// needs (task_id, cwd, state_dir, prompt); the in-process adapter also consumes model/tools/agent.
export type ManagedStartSpec = {
  readonly taskId: string
  readonly cwd: string
  readonly stateDir: string
  readonly prompt: string
  readonly depth: number
  readonly parentSessionId: string
  readonly rootSessionId: string
  readonly model?: string
  readonly requestedModel?: ResolvedModelRecord
  readonly fallbackModels?: readonly ResolvedModelRecord[]
  readonly variant?: string
  readonly agentType?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  readonly memberScopedTools?: readonly ToolDefinition[]
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type ManagedRunner = {
  start(spec: ManagedStartSpec): Promise<ManagedChildHandle>
}

export type ManagerStartSpec = {
  readonly prompt: string
  readonly parent_session_id: string
  readonly root_session_id?: string
  readonly depth: number
  readonly category?: string
  readonly subagent_type?: string
  readonly execution_mode?: ExecutionMode
  readonly model?: string
  readonly name?: string
  readonly description?: string
  readonly cwd?: string
  readonly instructions?: string
  readonly allowed_subagents?: readonly string[]
  readonly run_in_background?: boolean
  readonly memberScopedTools?: readonly ToolDefinition[]
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type ResolvedChildPlan = {
  readonly model: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
  readonly resolved_model?: ResolvedModelRecord
  readonly variant?: string
  readonly agentExecutionMode?: ExecutionMode
  readonly agentType?: string
  readonly category?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  readonly promptAppend?: string
  readonly allowedSubagents?: readonly string[]
  readonly maxDepth?: number
}

export type PlanResolutionError = {
  readonly code: "unknown_target" | "model_unavailable" | "category_disabled" | "invalid_target"
  readonly message: string
  readonly availableAgents?: readonly string[]
  readonly availableCategories?: readonly string[]
  // Dead-chain spawn detail: the category whose builtin fallback chain had zero resolvable rungs,
  // the rungs that were attempted, and the chain providers missing from the live registry.
  readonly category?: string
  readonly attempted_chain?: readonly DelegateFallbackEntry[]
  readonly missing_providers?: readonly string[]
}

export type PlanResolution =
  | { readonly kind: "resolved"; readonly plan: ResolvedChildPlan }
  | { readonly kind: "error"; readonly error: PlanResolutionError }

export type ChildPlanner = (spec: ManagerStartSpec) => PlanResolution

export type StartResult =
  | {
      readonly kind: "started"
      readonly task_id: string
      readonly status: "running" | "pending"
      readonly name: string
      readonly resolved_model?: ResolvedModelRecord
      readonly queue_position?: number
      readonly name_warning?: string
    }
  | {
      readonly kind: "depth_denied"
      readonly reason: string
      readonly child_depth: number
      readonly max_depth: number
    }
  | { readonly kind: "plan_unresolved"; readonly error: PlanResolutionError }
  | {
      readonly kind: "start_failed"
      readonly task_id: string
      readonly name: string
      readonly category?: string
      readonly subagent_type?: string
      readonly execution_mode: ExecutionMode
      readonly model: string
      readonly resolved_model?: ResolvedModelRecord
      readonly run_in_background: boolean
      readonly error_message: string
    }
  | { readonly kind: "residency_denied"; readonly reason: string }

export type ContinueDelivery = "steer" | "followUp" | "revive"

export type ContinueResult =
  | {
      readonly kind: "continued"
      readonly task_id: string
      readonly status: TaskStatus
      readonly delivered: ContinueDelivery
    }
  | { readonly kind: "not_continuable"; readonly task_id?: string; readonly reason: string; readonly suggestion: string }

export type ListScope =
  | { readonly scope: "parent-session"; readonly session_id: string }
  | { readonly scope: "all" }

export type ListedTask = {
  readonly record: TaskRecord
  readonly queue_position?: number
}

// Residency admission decision consulted by manager.start() at spawn (W1-V F7). The wiring adapts
// lifecycle.admitResident into this harness-neutral shape so the manager never imports lifecycle:
// `evicted` means a terminal resident was reclaimed to make room and the spawn may proceed.
export type SpawnAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "evicted"; readonly evicted_task_id: string }
  | { readonly kind: "rejected"; readonly message: string }

export type AdmitResident = (parentSessionId: string) => Promise<SpawnAdmission>

export type TrustedRespawnLaunch = {
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type TrustedRespawnLaunchResolver = (record: TaskRecord) => Promise<TrustedRespawnLaunch | undefined>

export type TaskManagerOptions = {
  readonly store: TaskRecordStore
  readonly runners: Readonly<Record<ExecutionMode, ManagedRunner>>
  readonly planner: ChildPlanner
  readonly config: OmoTaskSettings
  readonly cwd: string
  readonly now?: () => number
  // Injected by lifecycle (todo 12). Steering-driven cancel delegates destruction here; defaults to
  // a no-op so the manager stays usable before lifecycle wiring lands.
  readonly destruction?: DestructionPort
  // Injected by the todo-17 wiring. Consulted at spawn so the residency cap (LRU eviction) gates a
  // new child; absent -> admission is skipped (pre-wiring/unit behaviour, no cap enforcement).
  readonly admit?: AdmitResident
  // Resolves launch inputs from the current runtime. Persisted task records never supply executable
  // extensions or environment during a respawn.
  readonly trustedRespawnLaunch?: TrustedRespawnLaunchResolver
  // Pid recorded as host_pid on every claimed record so sibling processes sharing the project store
  // can tell a live owner from a dead one. Defaults to process.pid; injectable for tests.
  readonly hostPid?: number
}

export type TaskManager = {
  start(spec: ManagerStartSpec): Promise<StartResult>
  continueTask(taskIdOrName: string, prompt: string, deliverAs?: "steer" | "followUp"): Promise<ContinueResult>
  sendToTask(input: SendInput): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
  get(taskId: string): TaskRecord | undefined
  list(scope: ListScope): readonly ListedTask[]
  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord>
  // Live read of the manager-owned run-stats accumulator. Snapshot and live TUI surfaces need
  // in-flight turns/tool-calls/tok-s; the record only carries run_stats once terminal.
  // Optional so downstream structural fakes keep compiling; the concrete manager always implements it.
  runStatsSnapshot?(taskId: string): TaskRunStats | undefined
  // W1-V F3: prune a live handle (and its per-epoch release/background bookkeeping) so the lifecycle
  // destruction port and eviction path never leave a stale handle behind or grow #live unbounded.
  forget(taskId: string): void
  // Live-handle read seam for the wiring's ResidencyRegistry (W1-V F7: registry and #live share one
  // forget path). Returns the ManagedChildHandle for a task this process still owns, if any.
  getResidentHandle(taskId: string): ManagedChildHandle | undefined
  // Subscribe at the runner-agnostic handle seam now or when a queued task is promoted.
  subscribeChild(taskId: string, listener: ManagedChildListener): () => void
  residentTaskIds(): readonly string[]
  // Promote a foreground task when the tool stops waiting inline. The completion bridge reads this
  // state live at terminal transition, so promotion makes the eventual completion notify normally.
  promoteToBackground(taskId: string): boolean
  // Whether a task is currently background, either from its spawn spec or a later promotion.
  wasBackground(taskId: string): boolean
}
