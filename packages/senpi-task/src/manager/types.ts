import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { DagTaskOwner, DagTaskOwnerKey, OwnedStartResult } from "../dag/owner"
import type { IsolationRuntime, IsolationStartedDetails } from "../isolation"
import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import type { KernelToolGrant } from "../kernel-tools/resolve"
import type { ResolvedModelRecord, TaskRecord, TaskRunStats, TaskStatus } from "../state"
import type {
  CancelOptions,
  CancelOutcome,
  DestructionPort,
  InterruptOutcome,
  SendInput,
  SendOutcome,
} from "../steering"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle, ManagedChildListener } from "./child-handle"
import type { ExecutionMode, ExecutionModeGate } from "./execution-mode"
import type { TaskConcurrency } from "./concurrency"
import type { RunnerFailure } from "../runners/in-process/child-handle"
import type { InheritedExtensions } from "../runners/rpc/parent-extensions"
import type { WorkpoolEngine } from "../workpool/engine"

export type { ExecutionMode, ExecutionModeGate } from "./execution-mode"

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
  // The canonical resolved model (provider + model_id) chosen at plan time. Resume-time resolution
  // matches on this pair - never on the human display string, which need not be a registry id.
  readonly resolvedModel?: ResolvedModelRecord
  readonly variant?: string
  readonly agentType?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  // Names of tools the child must NOT get (the agent definition's disallowedTools), applied through
  // senpi's excludeTools so a resumed child never comes back with a wider tool surface.
  readonly toolDenylist?: readonly string[]
  // Names of the member-scoped ToolDefinitions, persisted on spawn_spec so a respawn can re-resolve
  // the executable definitions against the live parent registries.
  readonly memberScopedToolNames?: readonly string[]
  readonly memberScopedTools?: readonly ToolDefinition[]
  // TRANSIENT parent kernel-tool grant (item 6). Process-lifetime only: never persisted onto the
  // record or the v1 spawn_spec, which carry plain launch data exclusively.
  readonly kernelTools?: KernelToolGrant
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type ManagedRunner = {
  start(spec: ManagedStartSpec): Promise<ManagedChildHandle>
  // Rebuild a persisted child from its session transcript without replaying its prompt. Optional
  // until the mode adapters grow their resume paths (todo 10); start-only fakes keep compiling.
  resume?(spec: ManagedStartSpec, sessionPath: string): Promise<ManagedChildHandle>
}

export type ManagerStartSpec = {
  readonly isolated?: boolean
  readonly apply?: boolean
  readonly merge?: "patch" | "branch"
  readonly prompt: string
  readonly task_summary?: string
  readonly parent_session_id: string
  readonly root_session_id?: string
  readonly depth: number
  readonly category?: string
  readonly subagent_type?: string
  readonly execution_mode?: ExecutionMode
  readonly model?: string
  readonly name?: string
  readonly description?: string
  readonly team_run_id?: string
  readonly team_name?: string
  readonly team_member_name?: string
  readonly team_role?: "member"
  readonly cwd?: string
  readonly instructions?: string
  readonly allowed_subagents?: readonly string[]
  readonly run_in_background?: boolean
  readonly memberScopedTools?: readonly ToolDefinition[]
  // TRANSIENT parent kernel-tool grant resolved by the caller against its LIVE capability.
  readonly kernelTools?: KernelToolGrant
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
  // The resolved agent's disallowedTools, threaded onto the record as tool_deny.
  readonly toolDenylist?: readonly string[]
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
      // Emitted by the manager; optional for existing host implementations of TaskManager.
      readonly run_epoch?: number
      readonly status: "running" | "pending"
      readonly name: string
      readonly resolved_model?: ResolvedModelRecord
      readonly queue_position?: number
      readonly name_warning?: string
      // Where an isolated child is working. The merge outcome is NOT here: it does not exist yet.
      readonly isolation?: IsolationStartedDetails
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
      // The runner's typed failure kind (RunnerFailure["kind"]) when the runner rejected the start,
      // or `isolation_unavailable` when the child's copy-on-write clone could not be created.
      // so a caller can classify the refusal without parsing the sanitized message.
      readonly failure_kind?: RunnerFailure["kind"] | "isolation_unavailable"
    }
  | ResidencyDenied

// A resident child named by a residency rejection: enough for the caller to tell whether the cap
// is held by live work (wait for it) or by nothing that could ever free a slot (give up).
export type ResidentSummary = {
  readonly task_id: string
  readonly name: string
  readonly status: TaskStatus
}

// #8396: a residency denial states WHY admission failed so the caller can decide whether waiting
// helps. `residents` = the session's resident children occupy the cap; every one of them frees its
// slot on settlement, eviction, or when its pending sends drain, so a caller parks and re-probes
// after `TaskManager.residencyChanged(parentSessionId)`. A denial that names NO resident can never
// be helped by waiting. `lease` = the per-session admission lease was contended or displaced; the
// lease acquisition itself is a bounded wait, so the caller simply probes again.
export type ResidencyDenied =
  | {
      readonly kind: "residency_denied"
      readonly reason: string
      readonly cause: "residents"
      readonly max_children?: number | "unlimited"
      readonly residents: readonly ResidentSummary[]
    }
  | { readonly kind: "residency_denied"; readonly reason: string; readonly cause: "lease" }

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
  | {
      readonly kind: "rejected"
      readonly message: string
      // The residents that hold the cap (lifecycle AgentLimitReached). Omitted = the adapter could
      // not name them, which the manager reports as a denial nothing can free (#8396).
      readonly max_children?: number | "unlimited"
      readonly residents?: readonly ResidentSummary[]
    }

export type AdmitResident = (parentSessionId: string) => Promise<SpawnAdmission>

export type TrustedRespawnLaunch = {
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type TrustedRespawnLaunchResolver = (record: TaskRecord) => Promise<TrustedRespawnLaunch | undefined>

export type TaskManagerOptions = {
  readonly concurrency?: TaskConcurrency
  // Injected by row 17. Absent, `isolated` children are refused rather than silently run against the
  // parent checkout, so a wiring that forgot it can never break the isolation promise.
  readonly isolation?: IsolationRuntime
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
  // What a child of this session inherits when the caller names no explicit list. The composition
  // root passes a resolver that includes settings-installed package providers (#8492); absent, the
  // parent's argv entries are used, which is what a wiring without a package manager can know.
  readonly resolveInheritedExtensions?: InheritedExtensions
  // Pid recorded as host_pid on every claimed record so sibling processes sharing the project store
  // can tell a live owner from a dead one. Defaults to process.pid; injectable for tests.
  readonly hostPid?: number
  // The parent engine's RUNTIME-ONLY kernel-tool capability map (item 6). Shared with the runner so
  // a same-host parked child revives onto the same live parent closures; absent = no kernel tools.
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // The names a child of this parent already carries (same list the task tool grant reads).
  readonly resolveChildToolNames?: () => readonly string[]
  // Resolves `task.default_execution_mode: "auto"` ONCE per parent session (the shared-daemon
  // capability check). Absent -> `auto` reads as in-process, which is what a wiring without a
  // daemon (tests, a pinned engine without the host surface) must do.
  readonly executionModeGate?: ExecutionModeGate
}

export type TaskManager = {
  readonly workpools?: WorkpoolEngine
  // Optional for structural adapters; the concrete manager exposes its live lease allocator.
  readonly concurrency?: TaskConcurrency
  findTaskByChildSession?(sessionId: string): TaskRecord | undefined
  start(spec: ManagerStartSpec): Promise<StartResult>
  startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult>
  findOwnedTask(owner: DagTaskOwnerKey): TaskRecord | undefined
  continueTask(taskIdOrName: string, prompt: string, deliverAs?: "steer" | "followUp"): Promise<ContinueResult>
  sendToTask(input: SendInput): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  get(taskId: string): TaskRecord | undefined
  hasPendingSends?(taskId: string): boolean
  tryClaimEviction?(taskId: string): boolean
  releaseEviction?(taskId: string): void
  isEvicting?(taskId: string): boolean
  tryBeginSend?(taskId: string): boolean
  endSend?(taskId: string): void
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
  // #8396: session-scoped residency wake. Resolves the next time the parent session's residency
  // picture changes - a resident child reaches a terminal status, is forgotten (evicted, suspended,
  // destroyed), or has its last pending send drained - so a caller denied for residency can park
  // and re-probe instead of judging the SESSION by its own bookkeeping. Repeatable: each call arms
  // the NEXT change, so arm it BEFORE the probe whose denial you intend to wait out.
  residencyChanged(parentSessionId: string): Promise<void>
  // Promote a foreground task when the tool stops waiting inline. The completion bridge reads this
  // state live at terminal transition, so promotion makes the eventual completion notify normally.
  promoteToBackground(taskId: string): boolean
  // Whether a task is currently background, either from its spawn spec or a later promotion.
  wasBackground(taskId: string): boolean
}
