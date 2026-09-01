import type { ExecutionMode, StartResult } from "../../manager"
import type { ToolProgressDetails } from "../../progress"
import type { TaskRecord } from "../../state"
import type { TaskToolParamsStatic } from "./params"
import type { TaskSkillSummary, TaskToolDetails, TaskToolMode } from "./types"

export type SingleSpawnParams = Omit<TaskToolParamsStatic, "prompt" | "tasks"> & { readonly prompt: string }

export function recordSummary(record: TaskRecord, includeLifecycle?: boolean) {
  return {
    task_id: record.task_id,
    status: record.status,
    task_summary: record.task_summary,
    name: record.name,
    category: record.category,
    execution_mode: record.execution_mode,
    model: record.model,
    run_stats: record.run_stats,
    ...(includeLifecycle && {
          description: record.description,
          agent_type: record.agent_type,
          residency_state: record.residency_state,
          depth: record.depth,
          created_at: record.created_at,
          updated_at: record.updated_at,
        }),
  }
}

export function recordDetails(record: TaskRecord, mode: TaskToolMode): TaskToolDetails {
  return {
    ...recordSummary(record),
    mode,
    subagent_type: record.agent_type,
    resolved_model: record.resolved_model,
    fallback_attempts: record.fallback_attempts,
    run_in_background: false,
  }
}

export function startedDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: SingleSpawnParams,
  executionMode: ExecutionMode,
  skills?: TaskSkillSummary,
): TaskToolDetails {
  return {
    task_id: started.task_id,
    status: started.status,
    mode: "spawn",
    task_summary: params.task_summary,
    name: started.name,
    category: params.category,
    subagent_type: params.subagent_type,
    execution_mode: executionMode,
    model: params.model,
    resolved_model: started.resolved_model,
    run_in_background: params.run_in_background === true,
    queue_position: started.queue_position,
    ...(skills === undefined ? {} : { skills }),
  }
}

export function partialDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: SingleSpawnParams,
  executionMode: ExecutionMode,
  progress: ToolProgressDetails,
  skills?: TaskSkillSummary,
): TaskToolDetails & ToolProgressDetails {
  return { ...startedDetails(started, params, executionMode, skills), ...progress }
}
