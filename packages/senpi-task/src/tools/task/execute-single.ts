import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import { createChildProgress } from "../../progress"
import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import type { TaskRecord } from "../../state"
import { buildStartSpec } from "./execute-spec"
import type { ForegroundWaitOptions } from "./foreground-wait"
import { waitForForegroundTask } from "./foreground-wait"
import { partialDetails, recordDetails, startedDetails, type SingleSpawnParams } from "./result-details"
import { appendMissingSkills } from "./skill-result"
import { evaluateSpawnPolicy } from "./spawn-policy"
import { backgroundConversionText, backgroundStartText } from "./start-presentation"
import type { TaskToolContext, TaskToolDeps, TaskToolDetails, TaskToolMode } from "./types"
import { validateTaskTarget } from "./validation"

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

function syncResult(
  record: TaskRecord,
  mode: TaskToolMode,
  skills: ReturnType<typeof buildStartSpec>["skills"],
): AgentToolResult<TaskToolDetails> {
  const body = record.final_response ?? record.error_message ?? `Task ${record.status}`
  return result(
    appendMissingSkills(body + continuationFooter(record.task_id), skills),
    { ...recordDetails(record, mode), ...(skills === undefined ? {} : { skills }) },
  )
}

export async function runSpawn(
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
    return result(selection.error.message, {
      task_id: "",
      status: "invalid_arguments",
      mode: "spawn",
      reason: selection.error.message,
    })
  }
  const policy = selection.kind === "subagent_type"
    ? evaluateSpawnPolicy(deps, selection.subagentType, params.prompt, ctx.sessionManager.getSessionId())
    : undefined
  if (policy?.kind === "deny") {
    return result(policy.message, { task_id: "", status: "denied", mode: "spawn", reason: policy.message })
  }
  const effectiveParams = policy?.kind === "force" ? { ...params, prompt: policy.prompt, load_skills: [] } : params
  const target = selection.kind === "category" ? { category: selection.category } : { subagentType: selection.subagentType }
  // The default skill discovery inside buildStartSpec reads the senpi barrel synchronously, so the
  // barrel is warmed here (memoized: a cache hit once the engine barrel is loaded).
  await loadSenpiBarrel()
  const spec = buildStartSpec(effectiveParams, target, ctx.sessionManager.getSessionId(), deps, ctx.cwd)
  const started = await deps.manager.start(spec)
  if (started.kind === "plan_unresolved") {
    const agents = started.error.availableAgents
    const categories = started.error.availableCategories
    const agentSuffix = agents && agents.length > 0 ? ` Available agents: ${agents.join(", ")}.` : ""
    const categorySuffix = categories && categories.length > 0
      ? started.error.code === "model_unavailable"
        ? ` Valid category names: ${categories.join(", ")}. Retry one of these, or configure categories.<name>.models in omo.json — model overrides cannot be combined with category.`
        : ` Available categories: ${categories.join(", ")}.`
      : ""
    return result(started.error.message + agentSuffix + categorySuffix, {
      task_id: "",
      status: "plan_error",
      mode: "spawn",
      reason: started.error.message,
    })
  }
  if (started.kind === "depth_denied") {
    return result(started.reason, { task_id: "", status: "denied", mode: "spawn", reason: started.reason })
  }
  if (started.kind === "start_failed") {
    return result(appendMissingSkills(started.error_message, spec.skills), {
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
      ...(spec.skills === undefined ? {} : { skills: spec.skills }),
    })
  }
  if (started.kind === "residency_denied") {
    return result(started.reason, { task_id: "", status: "residency_denied", mode: "spawn", reason: started.reason })
  }
  if (params.run_in_background === true) {
    return result(
      appendMissingSkills(
        backgroundStartText(started, { taskSummary: params.task_summary, description: params.description }),
        spec.skills,
      ),
      startedDetails(started, params, spec.execution_mode, spec.skills),
    )
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
      ...(params.task_summary !== undefined && { taskSummary: params.task_summary }),
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
      details: partialDetails(started, params, spec.execution_mode, progress.details(), spec.skills),
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
      }, spec.skills),
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
      return result(appendMissingSkills(
        backgroundConversionText(
          started,
          { taskSummary: params.task_summary, description: params.description },
          waited.budgetSeconds,
        ),
        spec.skills,
      ), {
        ...startedDetails(started, params, spec.execution_mode, spec.skills),
        run_in_background: true,
      })
    }
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      emit()
    }
    return syncResult(waited.record, "spawn", spec.skills)
  } catch (error) {
    if (!signal?.aborted || error !== signal.reason) throw error
    const reason = "parent turn aborted"
    await deps.manager.cancelTask(started.task_id, reason)
    return result(`Task ${started.task_id} cancelled: ${reason}.${continuationFooter(started.task_id)}`, {
      ...startedDetails(started, params, spec.execution_mode, spec.skills),
      status: "cancelled",
      reason,
    })
  } finally {
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    unsubscribe()
  }
}
