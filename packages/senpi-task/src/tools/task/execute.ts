import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import { resolveExecutionMode, type ExecutionMode, type ManagerStartSpec } from "../../manager"
import type { TaskRecord } from "../../state"
import { createChildProgress } from "../../progress"
import { executeBatch } from "./execute-batch"
import { buildStartSpec, singleSpawnParams } from "./execute-spec"
import type { ForegroundWaitOptions } from "./foreground-wait"
import { waitForForegroundTask } from "./foreground-wait"
import type { TaskToolParamsStatic } from "./params"
import { partialDetails, recordDetails, startedDetails, type SingleSpawnParams } from "./result-details"
import { backgroundConversionText, backgroundStartText } from "./start-presentation"
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

type RunSpawnInput = ForegroundWaitOptions & {
  readonly params: SingleSpawnParams
  readonly signal: AbortSignal | undefined
  readonly onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined
  readonly ctx: TaskToolContext
}

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function continuationFooter(taskId: string): string {
  return `\n\n[task_id: ${taskId} - continue with task_send(to="${taskId}", message="...")]`
}

function syncResult(record: TaskRecord, mode: TaskToolMode): AgentToolResult<TaskToolDetails> {
  const body = record.final_response ?? record.error_message ?? `Task ${record.status}`
  return result(body + continuationFooter(record.task_id), recordDetails(record, mode))
}

async function runSpawn(
  deps: TaskToolDeps,
  input: RunSpawnInput,
): Promise<AgentToolResult<TaskToolDetails>> {
  const { params, signal, onUpdate, ctx, env, scheduleDeadline } = input
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
    // A model_unavailable failure means the category name IS valid; labeling the list "Available
    // categories" told models to retry the same broken binding. Name the vocabulary honestly and
    // point at the omo.json config escape hatch.
    const categorySuffix = categories && categories.length > 0
      ? started.error.code === "model_unavailable"
        ? ` Valid category names: ${categories.join(", ")}. Retry one of these, or configure categories.<name>.models in omo.json — model overrides cannot be combined with category.`
        : ` Available categories: ${categories.join(", ")}.`
      : ""
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
    return result(backgroundStartText(started, params.description), startedDetails(started, params, spec.execution_mode))
  }

  const startedAt = Date.now()
  const progress = createChildProgress(
    started.task_id,
    {
      ...(params.category !== undefined && { category: params.category }),
      ...(params.subagent_type !== undefined && { agentType: params.subagent_type }),
      ...(started.resolved_model !== undefined && { resolvedModel: started.resolved_model }),
      ...(params.model !== undefined && { model: params.model }),
      name: started.name,
      ...(params.description !== undefined && { description: params.description }),
    },
    startedAt,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  let emittedAt = 0
  let receivedChildEvent = false
  let closed = false
  const emit = (): void => {
    if (closed || onUpdate === undefined) return
    emittedAt = Date.now()
    onUpdate({
      content: [{ type: "text", text: progress.contentText() }],
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
      content: [{ type: "text", text: "" }],
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
    const waited = await waitForForegroundTask({
      manager: deps.manager,
      taskId: started.task_id,
      signal,
      ctx,
      ...(env !== undefined && { env }),
      ...(scheduleDeadline !== undefined && { scheduleDeadline }),
    })
    if (waited.kind === "promoted") {
      return result(backgroundConversionText(started, params.description, waited.budgetSeconds), {
        ...startedDetails(started, params, spec.execution_mode),
        run_in_background: true,
      })
    }
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      emit()
    }
    return syncResult(waited.record, "spawn")
  } catch (error) {
    if (!signal?.aborted || error !== signal.reason) throw error
    const reason = "parent turn aborted"
    await deps.manager.cancelTask(started.task_id, reason)
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

function invalidArguments(message: string): AgentToolResult<TaskToolDetails> {
  return result(message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: message })
}

export function buildTaskExecute(deps: TaskToolDeps, options: ForegroundWaitOptions = {}): TaskExecute {
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
    if (resolved.items.length === 1) {
      return runSpawn(deps, {
        params: singleSpawnParams(first, params.run_in_background),
        signal,
        onUpdate,
        ctx,
        ...(options.env !== undefined && { env: options.env }),
        ...(options.scheduleDeadline !== undefined && { scheduleDeadline: options.scheduleDeadline }),
      })
    }

    const parentSessionId = ctx.sessionManager.getSessionId()
    return executeBatch({
      manager: deps.manager,
      items: resolved.items,
      signal,
      ctx,
      runInBackground: params.run_in_background === true,
      ...(options.env !== undefined && { env: options.env }),
      ...(options.scheduleDeadline !== undefined && { scheduleDeadline: options.scheduleDeadline }),
      startItem: async (item) => {
        const itemParams = singleSpawnParams(item, params.run_in_background)
        const target = item.kind === "category" ? { category: item.category } : { subagentType: item.subagentType }
        const spec = buildStartSpec(itemParams, target, parentSessionId, deps, ctx.cwd)
        return deps.manager.start(spec)
      },
    })
  }
}
