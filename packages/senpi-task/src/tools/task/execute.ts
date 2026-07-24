import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import { resolveExecutionMode, type ExecutionMode, type ManagerStartSpec, type StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { createChildProgress, type ToolProgressDetails } from "../../progress"
import { executeBatch } from "./execute-batch"
import type { TaskToolParamsStatic } from "./params"
import { createFsSkillLoader } from "./skills"
import type { ResolvedSpawnItem, TaskToolContext, TaskToolDeps, TaskToolDetails, TaskToolMode } from "./types"
import { resolveSpawnItems, validateBatchShape, validateTaskTarget } from "./validation"

type TaskExecute = (
  toolCallId: string,
  params: TaskToolParamsStatic,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined,
  ctx: TaskToolContext,
) => Promise<AgentToolResult<TaskToolDetails>>

type ResolvedManagerStartSpec = ManagerStartSpec & { readonly execution_mode: ExecutionMode }

type SingleSpawnParams = Omit<TaskToolParamsStatic, "prompt" | "tasks"> & { readonly prompt: string }

type RunSpawnInput = {
  readonly params: SingleSpawnParams
  readonly signal: AbortSignal | undefined
  readonly onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined
  readonly ctx: TaskToolContext
  readonly parentSessionId: string
}

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function continuationFooter(taskId: string): string {
  return `\n\n[task_id: ${taskId} - continue with task_send(to="${taskId}", message="...")]`
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
    ...(record.resolved_model !== undefined && { resolved_model: record.resolved_model }),
    run_in_background: false,
  }
}

function syncResult(record: TaskRecord, mode: TaskToolMode): AgentToolResult<TaskToolDetails> {
  const body = record.final_response ?? record.error_message ?? `Task ${record.status}`
  return result(body + continuationFooter(record.task_id), recordDetails(record, mode))
}

function buildStartSpec(
  params: SingleSpawnParams,
  target: { readonly category: string } | { readonly subagentType: string },
  parentSessionId: string,
  deps: TaskToolDeps,
  cwd: string,
): ResolvedManagerStartSpec {
  const ancestry = deps.resolveAncestry?.(parentSessionId)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const skills = loadSkills(params.load_skills ?? [], cwd)
  const executionMode = resolvedTaskExecutionMode(target, deps)
  const lineage = ancestry?.lineage ?? "unknown"
  const callerRole = ancestry?.callerRole ?? "leaf"
  return {
    prompt: skills.prepend + params.prompt,
    parent_session_id: parentSessionId,
    root_session_id: ancestry?.rootSessionId ?? parentSessionId,
    depth: (ancestry?.depth ?? 0) + 1,
    lineage,
    caller_role: callerRole,
    ...("category" in target ? { category: target.category } : { subagent_type: target.subagentType }),
    execution_mode: executionMode,
    ...(params.model !== undefined && { model: params.model }),
    ...(params.name !== undefined && { name: params.name }),
    ...(params.run_in_background !== undefined && { run_in_background: params.run_in_background }),
    ...(ancestry?.callerMaxDepth !== undefined ? { caller_max_depth: ancestry.callerMaxDepth } : {}),
    ...(ancestry?.allowedSubagents !== undefined ? { allowed_subagents: ancestry.allowedSubagents } : {}),
  }
}

function toExecutionMode(value: string | undefined): ExecutionMode | undefined {
  switch (value) {
    case "in-process":
    case "process":
      return value
    default:
      return undefined
  }
}

function resolvedAgentMode(
  target: { readonly category: string } | { readonly subagentType: string },
  deps: TaskToolDeps,
): ExecutionMode | undefined {
  if (!("subagentType" in target)) return undefined
  return toExecutionMode(deps.agents[target.subagentType]?.executionMode) ?? deps.omoConfig.agents?.[target.subagentType]?.execution_mode
}

function resolvedTaskExecutionMode(
  target: { readonly category: string } | { readonly subagentType: string },
  deps: TaskToolDeps,
): ExecutionMode {
  const agentMode = resolvedAgentMode(target, deps)
  return resolveExecutionMode({
    ...(agentMode !== undefined && { agentMode }),
    configMode: deps.omoConfig.task?.default_execution_mode,
  })
}

function startedDetails(
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

function partialDetails(
  started: Extract<StartResult, { kind: "started" }>,
  params: SingleSpawnParams,
  executionMode: ExecutionMode,
  progress: ToolProgressDetails,
): TaskToolDetails & ToolProgressDetails {
  return { ...startedDetails(started, params, executionMode), ...progress }
}

function backgroundStartText(started: Extract<StartResult, { kind: "started" }>): string {
  const queue = started.queue_position !== undefined ? ` queued at position ${started.queue_position}` : ""
  return `Started task ${started.task_id} (${started.status})${queue}. The system will notify you on completion; use task_output to read progress or task_send to steer it.`
}

async function runSpawn(
  deps: TaskToolDeps,
  input: RunSpawnInput,
): Promise<AgentToolResult<TaskToolDetails>> {
  const { params, signal, onUpdate, ctx, parentSessionId } = input
  if (signal?.aborted) {
    const reason = "Parent aborted before spawn"
    return result(reason, { task_id: "", status: "cancelled", mode: "spawn", reason })
  }
  const selection = validateTaskTarget(params)
  if (selection.kind === "error") {
    return result(selection.error.message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: selection.error.message })
  }
  const target = selection.kind === "category" ? { category: selection.category } : { subagentType: selection.subagentType }
  const spec = buildStartSpec(params, target, ctx.sessionManager.getSessionId(), deps, ctx.cwd)
  const started = await deps.manager.start(spec)
  if (started.kind === "plan_unresolved") {
    const agents = started.error.availableAgents
    const categories = started.error.availableCategories
    const agentSuffix = agents && agents.length > 0 ? ` Available agents: ${agents.join(", ")}.` : ""
    const categorySuffix = categories && categories.length > 0 ? ` Available categories: ${categories.join(", ")}.` : ""
    return result(started.error.message + agentSuffix + categorySuffix, { task_id: "", status: "plan_error", mode: "spawn", reason: started.error.message })
  }
  if (started.kind === "depth_denied") {
    return result(started.reason, { task_id: "", status: "denied", mode: "spawn", reason: started.reason })
  }
  if (started.kind === "start_failed") {
    return result(started.error_message, {
      task_id: started.task_id,
      status: "error",
      mode: "spawn",
      name: started.name,
      ...(started.category !== undefined && { category: started.category }),
      ...(started.subagent_type !== undefined && { subagent_type: started.subagent_type }),
      execution_mode: started.execution_mode,
      model: started.model,
      ...(started.resolved_model !== undefined && { resolved_model: started.resolved_model }),
      run_in_background: started.run_in_background,
      reason: started.error_message,
    })
  }
  if (started.kind === "residency_denied") {
    return result(started.reason, { task_id: "", status: "residency_denied", mode: "spawn", reason: started.reason })
  }
  // Background children intentionally outlive the parent turn; only the synchronous wait is abort-scoped.
  if (params.run_in_background === true) {
    return result(backgroundStartText(started), startedDetails(started, params, spec.execution_mode))
  }

  const startedAt = Date.now()
  const progress = createChildProgress(started.task_id, params.category, startedAt)
  let timer: ReturnType<typeof setTimeout> | undefined
  let emittedAt = 0
  let receivedChildEvent = false
  let closed = false
  const emit = (): void => {
    if (closed || onUpdate === undefined) return
    emittedAt = Date.now()
    onUpdate({
      content: [{ type: "text", text: progress.text(emittedAt) }],
      details: partialDetails(started, params, spec.execution_mode, progress.details()),
    })
  }
  const schedule = (): void => {
    if (closed || onUpdate === undefined) return
    if (!receivedChildEvent) {
      receivedChildEvent = true
      emit()
      return
    }
    const remaining = 250 - (Date.now() - emittedAt)
    if (remaining <= 0) {
      emit()
    } else if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        emit()
      }, remaining)
      timer.unref?.()
    }
  }
  const unsubscribe = deps.manager.subscribeChild(started.task_id, (event) => {
    if (progress.accept(event)) schedule()
  })
  if (started.status === "pending") {
    onUpdate?.({
      content: [{ type: "text", text: "queued · waiting for slot" }],
      details: partialDetails(started, params, spec.execution_mode, {
        progress: { activity: "queued · waiting for slot", startedAt },
        childId: started.task_id,
        turns: 0,
      }),
    })
  } else {
    emit()
  }
  try {
    const final = await deps.manager.waitFor(started.task_id, { signal })
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      emit()
    }
    return syncResult(final, "spawn")
  } catch (error) {
    if (!signal?.aborted || error !== signal.reason) throw error
    const reason = "parent turn aborted"
    await deps.manager.cancelTask(started.task_id, reason, parentSessionId)
    return result(`Task ${started.task_id} cancelled: ${reason}.${continuationFooter(started.task_id)}`, {
      ...startedDetails(started, params, spec.execution_mode),
      status: "cancelled",
      reason,
    })
  } finally {
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    unsubscribe()
  }
}

function singleSpawnParams(item: ResolvedSpawnItem, runInBackground: boolean | undefined): SingleSpawnParams {
  return {
    prompt: item.prompt,
    ...(item.kind === "category" ? { category: item.category } : { subagent_type: item.subagentType }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.name !== undefined && { name: item.name }),
    ...(item.model !== undefined && { model: item.model }),
    load_skills: [...item.load_skills],
    ...(runInBackground !== undefined && { run_in_background: runInBackground }),
  }
}

function invalidArguments(message: string): AgentToolResult<TaskToolDetails> {
  return result(message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: message })
}

export function buildTaskExecute(deps: TaskToolDeps): TaskExecute {
  return async (_toolCallId, params, signal, onUpdate, ctx) => {
    const shape = validateBatchShape(params)
    if (shape.kind === "error") return invalidArguments(shape.error.message)

    const resolved = resolveSpawnItems(params)
    if (resolved.kind === "error") {
      if (shape.kind === "single" && resolved.error.code === "item_target") {
        const target = validateTaskTarget(params)
        if (target.kind === "error") return invalidArguments(target.error.message)
      }
      return invalidArguments(resolved.error.message)
    }

    const first = resolved.items[0]
  if (first === undefined) return invalidArguments("Provide at least one task item.")
    const parentSessionId = ctx.sessionManager.getSessionId()
    if (resolved.items.length === 1) {
      return runSpawn(deps, { params: singleSpawnParams(first, params.run_in_background), signal, onUpdate, ctx, parentSessionId })
    }

    return executeBatch({
      manager: deps.manager,
      items: resolved.items,
      signal,
      callerSessionId: parentSessionId,
      runInBackground: params.run_in_background === true,
      startItem: async (item) => {
        const itemParams = singleSpawnParams(item, params.run_in_background)
        const target = item.kind === "category" ? { category: item.category } : { subagentType: item.subagentType }
        const spec = buildStartSpec(itemParams, target, parentSessionId, deps, ctx.cwd)
        return deps.manager.start(spec)
      },
    })
  }
}
