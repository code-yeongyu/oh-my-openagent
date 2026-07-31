import type { ExecutionMode, StartResult } from "../../manager"
import type { ToolProgressDetails } from "../../progress"
import type { TaskRecord } from "../../state"
import type { TaskToolParamsStatic } from "./params"
import type { TaskToolDetails, TaskToolMode } from "./types"

export type SingleSpawnParams = Omit<TaskToolParamsStatic, "prompt" | "tasks"> & { readonly prompt: string }

export function recordDetails(record: TaskRecord, mode: TaskToolMode): TaskToolDetails {
  return {
    task_id: record.task_id,
    status: record.status,
    mode,
    ...(record.name !== undefined && { name: record.name }),
    ...(record.category !== undefined && { category: record.category }),
    ...(record.agent_type !== undefined && { subagent_type: record.agent_type }),
    execution_mode: record.execution_mode,
    model: record.model,
    ...(record.resolved_model !== undefined && { resolved_model: record.resolved_model }),
    ...(record.fallback_attempts !== undefined && { fallback_attempts: record.fallback_attempts }),
    ...(record.run_stats !== undefined && { run_stats: record.run_stats }),
    run_in_background: false,
  }
}

export function startedDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: SingleSpawnParams,
  executionMode: ExecutionMode,
): TaskToolDetails {
  return {
    task_id: started.task_id,
    status: started.status,
    mode: "spawn",
    name: started.name,
    ...(params.category !== undefined && { category: params.category }),
    ...(params.subagent_type !== undefined && { subagent_type: params.subagent_type }),
    execution_mode: executionMode,
    ...(params.model !== undefined && { model: params.model }),
    ...(started.resolved_model !== undefined && { resolved_model: started.resolved_model }),
    run_in_background: params.run_in_background === true,
    ...(started.queue_position !== undefined && { queue_position: started.queue_position }),
  }
}

export function partialDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: SingleSpawnParams,
  executionMode: ExecutionMode,
  progress: ToolProgressDetails,
): TaskToolDetails & ToolProgressDetails {
  return { ...startedDetails(started, params, executionMode), ...progress }
}
