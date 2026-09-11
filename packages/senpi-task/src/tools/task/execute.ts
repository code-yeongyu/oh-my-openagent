import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { executeBatch } from "./execute-batch"
import { runSpawn } from "./execute-single"
import { buildStartSpec, singleSpawnParams } from "./execute-spec"
import type { ForegroundWaitOptions } from "./foreground-wait"
import { evaluateSpawnPolicy } from "./spawn-policy"
import { appendLegacyNoticeLines, type LegacySubagentAlias } from "./start-presentation"
import type { TaskToolParamsStatic } from "./params"
import type { ResolvedSpawnItem, TaskSkillSummary, TaskToolContext, TaskToolDeps, TaskToolDetails } from "./types"
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

// resolveSpawnItems stamps the retired id onto a resolved item additively (in-memory only;
// ResolvedSpawnItem deliberately does not widen), so it is read here to thread the deprecation
// notice without re-deriving the target merge.
function legacySubagentTypeOf(item: ResolvedSpawnItem): string | undefined {
  return (item as ResolvedSpawnItem & { readonly legacySubagentType?: string }).legacySubagentType
}

function legacyAliasesOf(items: readonly ResolvedSpawnItem[]): readonly LegacySubagentAlias[] {
  const aliases: LegacySubagentAlias[] = []
  for (const item of items) {
    if (item.kind !== "subagent_type") continue
    const legacy = legacySubagentTypeOf(item)
    if (legacy !== undefined) aliases.push({ legacy, canonical: item.subagentType })
  }
  return aliases
}

// The batch start text is composed inside executeBatch, so the deprecation notices are appended to
// its result here: one line per distinct retired id used in the call, never one per duplicate item.
function withLegacyNotices(
  batchResult: AgentToolResult<TaskToolDetails>,
  aliases: readonly LegacySubagentAlias[],
): AgentToolResult<TaskToolDetails> {
  if (aliases.length === 0) return batchResult
  const [first, ...rest] = batchResult.content
  if (first === undefined || first.type !== "text") return batchResult
  return { ...batchResult, content: [{ ...first, text: appendLegacyNoticeLines(first.text, aliases) }, ...rest] }
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
    if (resolved.items.length === 1) {
      const legacySubagentType = legacySubagentTypeOf(first)
      return runSpawn(deps, {
        params: singleSpawnParams(first, runInBackground),
        ...(legacySubagentType !== undefined && { legacySubagentType }),
        signal,
        onUpdate,
        ctx,
        ...(options.env !== undefined && { env: options.env }),
        ...(options.scheduleDeadline !== undefined && { scheduleDeadline: options.scheduleDeadline }),
      })
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
        const spec = buildStartSpec(itemParams, target, parentSessionId, deps, ctx.cwd)
        if (spec.skills !== undefined) skillSummaries.set(item, spec.skills)
        return deps.manager.start(spec)
      },
    })
    return withLegacyNotices(batchResult, legacyAliasesOf(resolved.items))
  }
}
