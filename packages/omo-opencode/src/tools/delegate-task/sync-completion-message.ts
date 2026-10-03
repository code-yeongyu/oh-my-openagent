import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import type { ParentContext } from "./executor-types"
import type { SyncOutcomeState } from "./sync-session-turns"
import { formatDuration } from "./time-formatter"
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types"

function formatModelID(model: DelegatedModelConfig | ParentContext["model"] | undefined): string | undefined {
  return model ? `${model.providerID}/${model.modelID}` : undefined
}

function outcomeHeadline(endState: SyncOutcomeState | undefined, duration: string): string {
  if (endState === "interrupted") return `Task ended before completion (session interrupted) in ${duration}.`
  if (endState === "failed") return `Task failed in ${duration}.`
  return `Task completed in ${duration}.`
}

export function buildRecoveredSyncTaskCompletion(input: {
  readonly activeSessionID: string
  readonly agentToUse: string
  readonly args: DelegateTaskArgs
  readonly effectiveCategoryModel: DelegatedModelConfig | undefined
  readonly parentContext: ParentContext
  readonly startTime: Date
  readonly textContent: string
  readonly endState?: SyncOutcomeState
}): string {
  const duration = formatDuration(input.startTime)
  const actualModelStr = formatModelID(input.effectiveCategoryModel)
  const parentModelStr = formatModelID(input.parentContext.model)
  let modelRoutingNote = ""
  if (actualModelStr && parentModelStr && actualModelStr !== parentModelStr) {
    modelRoutingNote = `\n⚠️  Model fallback used: requested ${parentModelStr}, executed ${actualModelStr}`
  }

  return `${outcomeHeadline(input.endState, duration)}\n\n---\n\n${input.textContent || "(No text output)"}${modelRoutingNote}\n\n${buildTaskMetadataBlock({
    sessionId: input.activeSessionID,
    taskId: input.activeSessionID,
    agent: input.agentToUse,
    category: input.args.category,
  })}`
}

export function buildSyncTaskCompletion(input: {
  readonly activeSessionID: string
  readonly agentToUse: string
  readonly args: DelegateTaskArgs
  readonly effectiveCategoryModel: DelegatedModelConfig | undefined
  readonly parentContext: ParentContext
  readonly startTime: Date
  readonly textContent: string
  readonly endState?: SyncOutcomeState
}): string {
  const duration = formatDuration(input.startTime)
  const actualModelStr = formatModelID(input.effectiveCategoryModel)
  const parentModelStr = formatModelID(input.parentContext.model)
  let modelRoutingNote = ""
  if (actualModelStr && parentModelStr && actualModelStr !== parentModelStr) {
    modelRoutingNote = `\n⚠️  Model routing: parent used ${parentModelStr}, this subagent used ${actualModelStr} (via category: ${input.args.category ?? "unknown"})`
  } else if (actualModelStr) {
    modelRoutingNote = `\nModel: ${actualModelStr}${input.args.category ? ` (category: ${input.args.category})` : ""}`
  }

  return `${outcomeHeadline(input.endState, duration)}

Agent: ${input.agentToUse}${input.args.category ? ` (category: ${input.args.category})` : ""}${modelRoutingNote}

---

${input.textContent || "(No text output)"}

${buildTaskMetadataBlock({
    sessionId: input.activeSessionID,
    taskId: input.activeSessionID,
    agent: input.agentToUse,
    category: input.args.category,
  })}`
}
