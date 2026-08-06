import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import type { ParentContext } from "./executor-types"
import { formatDuration } from "./time-formatter"
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types"

function formatModelID(model: DelegatedModelConfig | ParentContext["model"] | undefined): string | undefined {
  return model ? `${model.providerID}/${model.modelID}` : undefined
}

export function buildRecoveredSyncTaskCompletion(input: {
  readonly activeSessionID: string
  readonly agentToUse: string
  readonly args: DelegateTaskArgs
  readonly effectiveCategoryModel: DelegatedModelConfig | undefined
  readonly parentContext: ParentContext
  readonly startTime: Date
  readonly textContent: string
}): string {
  const duration = formatDuration(input.startTime)
  const actualModelStr = formatModelID(input.effectiveCategoryModel)
  const parentModelStr = formatModelID(input.parentContext.model)
  let modelRoutingNote = ""
  if (actualModelStr && parentModelStr && actualModelStr !== parentModelStr) {
    modelRoutingNote = `\n⚠️  Model fallback used: requested ${parentModelStr}, executed ${actualModelStr}`
  }

  return `Task completed in ${duration}.\n\n---\n\n${input.textContent || "(No text output)"}${modelRoutingNote}\n\n${buildTaskMetadataBlock({
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

  return `Task completed in ${duration}.

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
