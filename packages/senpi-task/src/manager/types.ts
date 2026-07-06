import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { TaskRecord, TaskStatus } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
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
  readonly agentType?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  readonly memberScopedTools?: readonly ToolDefinition[]
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
  readonly cwd?: string
  readonly instructions?: string
  readonly allowed_subagents?: readonly string[]
  readonly run_in_background?: boolean
  readonly memberScopedTools?: readonly ToolDefinition[]
}

export type ResolvedChildPlan = {
  readonly model: string
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
  readonly availableCategories?: readonly string[]
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
  | { readonly kind: "start_failed"; readonly task_id: string; readonly name: string; readonly error_message: string }

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

export type TaskManagerOptions = {
  readonly store: TaskRecordStore
  readonly runners: Readonly<Record<ExecutionMode, ManagedRunner>>
  readonly planner: ChildPlanner
  readonly config: OmoTaskSettings
  readonly cwd: string
  readonly now?: () => number
}

export type TaskManager = {
  start(spec: ManagerStartSpec): Promise<StartResult>
  continueTask(taskIdOrName: string, prompt: string, deliverAs?: "steer" | "followUp"): Promise<ContinueResult>
  get(taskId: string): TaskRecord | undefined
  list(scope: ListScope): readonly ListedTask[]
  waitFor(taskId: string): Promise<TaskRecord>
}
