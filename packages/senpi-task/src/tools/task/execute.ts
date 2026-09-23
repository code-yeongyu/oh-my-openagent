import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { executeBatch } from "./execute-batch"
import { runSpawn } from "./execute-single"
import { buildStartSpec, ensureAutoExecutionMode, singleSpawnParams } from "./execute-spec"
import type { ForegroundWaitOptions } from "./foreground-wait"
import { resolveTaskKernelTools } from "./kernel-tools"
import { evaluateSpawnPolicy } from "./spawn-policy"
import type { TaskToolParamsStatic } from "./params"
import type {
  ResolvedSpawnItem,
  TaskKernelToolsDetail,
  TaskSkillSummary,
  TaskToolContext,
  TaskToolDeps,
  TaskToolDetails,
} from "./types"
import { resolveRunInBackground, resolveSpawnItems, validateBatchShape, validateTaskTarget } from "./validation"

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

function invalidArguments(message: string): AgentToolResult<TaskToolDetails> {
  return result(message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: message })
}

/**
 * What the caller is told about a resolved grant once the spawn settled. A spawn that never started
 * must NEVER report `granted`: a runner-floor refusal carries its typed code, and any other failed
 * start reports that the grant reached no child.
 */
function deliveredKernelTools(detail: TaskKernelToolsDetail, details: TaskToolDetails): TaskKernelToolsDetail {
  if (details.failure_kind === "tools_unavailable") {
    return {
      requested: detail.requested,
      status: "refused",
      error: { code: "tools_unavailable", message: details.reason ?? "Parent kernel tools are unavailable for this child." },
    }
  }
  if (details.task_id.length === 0 || details.failure_kind !== undefined) {
    return { requested: detail.requested, status: "not_delivered" }
  }
  return detail
}

export function buildTaskExecute(deps: TaskToolDeps, options: ForegroundWaitOptions = {}): TaskExecute {
  return async (_toolCallId, params, signal, onUpdate, ctx) => {
    const shape = validateBatchShape(params)
    if (shape.kind === "error") return invalidArguments(shape.error.message)

    const background = resolveRunInBackground(params)
    if (background.kind === "error") return invalidArguments(background.error.message)
    const runInBackground = background.runInBackground

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

    for (const item of resolved.items) {
      const isolated = item.isolated ?? deps.omoConfig.task?.isolation?.enabled ?? false
      if (!isolated && (item.apply !== undefined || item.merge !== undefined)) {
        return invalidArguments("apply and merge require isolated: true or task.isolation.enabled.")
      }
    }

    // The parent session's one daemon check, settled BEFORE any spec is built so every child of
    // this call records the same execution mode (and a kernel-tool grant is decided against it).
    await ensureAutoExecutionMode(deps)

    // Parent kernel tools are resolved BEFORE any spawn: a refusal must leave zero child sessions.
    const kernelTools = await resolveTaskKernelTools(deps, ctx, resolved.items, params.tools)
    if (kernelTools.kind === "denied") {
      const message = kernelTools.detail.error?.message ?? "Parent kernel tools are unavailable."
      return result(message, {
        task_id: "",
        status: "denied",
        mode: "spawn",
        reason: message,
        kernel_tools: kernelTools.detail,
      })
    }
    const granted = kernelTools.kind === "granted" ? kernelTools : undefined
    const withKernelTools = (spawned: AgentToolResult<TaskToolDetails>): AgentToolResult<TaskToolDetails> =>
      granted === undefined
        ? spawned
        : { ...spawned, details: { ...spawned.details, kernel_tools: deliveredKernelTools(granted.detail, spawned.details) } }

    if (resolved.items.length === 1) {
      return withKernelTools(await runSpawn(deps, {
        params: singleSpawnParams(first, runInBackground),
        signal,
        onUpdate,
        ctx,
        ...(granted === undefined ? {} : { kernelTools: granted.grant }),
        ...(options.env !== undefined && { env: options.env }),
        ...(options.scheduleDeadline !== undefined && { scheduleDeadline: options.scheduleDeadline }),
      }))
    }

    const parentSessionId = ctx.sessionManager.getSessionId()
    const skillSummaries = new WeakMap<ResolvedSpawnItem, TaskSkillSummary>()
    const batchResult = await executeBatch({
      manager: deps.manager,
      items: resolved.items,
      signal,
      ctx,
      ...(onUpdate !== undefined && { onUpdate }),
      runInBackground: runInBackground === true,
      ...(options.env !== undefined && { env: options.env }),
      ...(options.scheduleDeadline !== undefined && { scheduleDeadline: options.scheduleDeadline }),
      skillSummaryFor: (item) => skillSummaries.get(item),
      startItem: async (item) => {
        let itemParams = singleSpawnParams(item, runInBackground)
        const target = item.kind === "category" ? { category: item.category } : { subagentType: item.subagentType }
        if (item.kind === "subagent_type") {
          const policy = evaluateSpawnPolicy(deps, item.subagentType, itemParams.prompt, parentSessionId)
          if (policy.kind === "deny") {
            return { kind: "plan_unresolved", error: { code: "invalid_target", message: policy.message } }
          }
          if (policy.kind === "force") {
            itemParams = { ...itemParams, prompt: policy.prompt, load_skills: [] }
          }
        }
        // The default skill discovery inside buildStartSpec reads the senpi barrel synchronously,
        // so the barrel is warmed here (memoized across every spawn in the process).
        await loadSenpiBarrel()
        const spec = buildStartSpec(itemParams, target, parentSessionId, deps, ctx.cwd, granted?.grant)
        if (spec.skills !== undefined) skillSummaries.set(item, spec.skills)
        return deps.manager.start(spec)
      },
    })
    return withKernelTools(batchResult)
  }
}
