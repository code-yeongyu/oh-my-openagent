import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import type { ContinueResult, ManagerStartSpec, StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import type { TaskToolParamsStatic } from "./params"
import { createFsSkillLoader } from "./skills"
import type { TaskToolContext, TaskToolDeps, TaskToolDetails, TaskToolMode } from "./types"
import { validateTaskTarget } from "./validation"

type TaskExecute = (
  toolCallId: string,
  params: TaskToolParamsStatic,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined,
  ctx: TaskToolContext,
) => Promise<AgentToolResult<TaskToolDetails>>

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function continuationFooter(taskId: string): string {
  return `\n\n[task_id: ${taskId} - continue with task(task_id="${taskId}", prompt="...")]`
}

function recordDetails(record: TaskRecord, mode: TaskToolMode): TaskToolDetails {
  return {
    task_id: record.task_id,
    status: record.status,
    mode,
    ...(record.name !== undefined && { name: record.name }),
    ...(record.category !== undefined && { category: record.category }),
    ...(record.agent_type !== undefined && { subagent_type: record.agent_type }),
    execution_mode: record.execution_mode,
    model: record.model,
  }
}

function syncResult(record: TaskRecord, mode: TaskToolMode): AgentToolResult<TaskToolDetails> {
  const body = record.final_response ?? record.error_message ?? `Task ${record.status}`
  return result(body + continuationFooter(record.task_id), recordDetails(record, mode))
}

function buildStartSpec(
  params: TaskToolParamsStatic,
  target: { readonly category: string } | { readonly subagentType: string },
  parentSessionId: string,
  deps: TaskToolDeps,
  cwd: string,
): ManagerStartSpec {
  const ancestry = deps.resolveAncestry?.(parentSessionId)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const skills = loadSkills(params.load_skills ?? [], cwd)
  return {
    prompt: skills.prepend + params.prompt,
    parent_session_id: parentSessionId,
    root_session_id: ancestry?.rootSessionId ?? parentSessionId,
    depth: (ancestry?.depth ?? 0) + 1,
    ...("category" in target ? { category: target.category } : { subagent_type: target.subagentType }),
    ...(params.execution_mode !== undefined && { execution_mode: params.execution_mode }),
    ...(params.model !== undefined && { model: params.model }),
    ...(params.name !== undefined && { name: params.name }),
    ...(params.run_in_background !== undefined && { run_in_background: params.run_in_background }),
  }
}

function startedDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: TaskToolParamsStatic,
): TaskToolDetails {
  return {
    task_id: started.task_id,
    status: started.status,
    mode: "spawn",
    name: started.name,
    ...(params.category !== undefined && { category: params.category }),
    ...(params.subagent_type !== undefined && { subagent_type: params.subagent_type }),
    ...(params.execution_mode !== undefined && { execution_mode: params.execution_mode }),
    ...(params.model !== undefined && { model: params.model }),
    run_in_background: params.run_in_background === true,
    ...(started.queue_position !== undefined && { queue_position: started.queue_position }),
  }
}

function backgroundStartText(started: Extract<StartResult, { kind: "started" }>): string {
  const queue = started.queue_position !== undefined ? ` queued at position ${started.queue_position}` : ""
  return `Started task ${started.task_id} (${started.status})${queue}. The system will notify you on completion; use task_output to read progress or task_send to steer it.`
}

async function runSpawn(
  deps: TaskToolDeps,
  params: TaskToolParamsStatic,
  ctx: TaskToolContext,
): Promise<AgentToolResult<TaskToolDetails>> {
  const selection = validateTaskTarget(params)
  if (selection.kind === "error") {
    return result(selection.error.message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: selection.error.message })
  }
  const target = selection.kind === "category" ? { category: selection.category } : { subagentType: selection.subagentType }
  const spec = buildStartSpec(params, target, ctx.sessionManager.getSessionId(), deps, ctx.cwd)
  const started = await deps.manager.start(spec)
  if (started.kind === "plan_unresolved") {
    const available = started.error.availableCategories
    const suffix = available && available.length > 0 ? ` Available categories: ${available.join(", ")}.` : ""
    return result(started.error.message + suffix, { task_id: "", status: "plan_error", mode: "spawn", reason: started.error.message })
  }
  if (started.kind === "depth_denied") {
    return result(started.reason, { task_id: "", status: "denied", mode: "spawn", reason: started.reason })
  }
  if (started.kind === "start_failed") {
    return result(started.error_message, { task_id: started.task_id, status: "error", mode: "spawn", name: started.name, reason: started.error_message })
  }
  if (params.run_in_background === true) {
    return result(backgroundStartText(started), startedDetails(started, params))
  }
  const final = await deps.manager.waitFor(started.task_id)
  return syncResult(final, "spawn")
}

async function runContinuation(
  deps: TaskToolDeps,
  params: TaskToolParamsStatic,
  taskId: string,
): Promise<AgentToolResult<TaskToolDetails>> {
  const outcome: ContinueResult = await deps.manager.continueTask(taskId, params.prompt, "followUp")
  if (outcome.kind === "not_continuable") {
    const resolvedId = outcome.task_id ?? taskId
    return result(`${outcome.reason}. ${outcome.suggestion}`, { task_id: resolvedId, status: "not_continuable", mode: "continuation", reason: outcome.reason })
  }
  if (params.run_in_background === true) {
    return result(
      `Delivered to task ${outcome.task_id} via ${outcome.delivered} (${outcome.status}). The system will notify you on completion.`,
      { task_id: outcome.task_id, status: outcome.status, mode: "continuation", run_in_background: true },
    )
  }
  const final = await deps.manager.waitFor(outcome.task_id)
  return syncResult(final, "continuation")
}

// The task tool execute logic. Injects the caller (parent) session id into every manager call,
// routes to continuation when task_id is present, and composes start + waitFor for sync spawns while
// background spawns return immediately without awaiting child completion.
export function buildTaskExecute(deps: TaskToolDeps): TaskExecute {
  return async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    const taskId = params.task_id?.trim()
    if (taskId !== undefined && taskId.length > 0) {
      return runContinuation(deps, params, taskId)
    }
    return runSpawn(deps, params, ctx)
  }
}
