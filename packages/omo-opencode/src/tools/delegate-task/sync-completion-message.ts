import { buildTaskMetadataBlock } from "../../features/tool-metadata-store/task-metadata-contract"
import type { ParentContext } from "./executor-types"
import { formatDuration } from "./time-formatter"
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types"

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
  const modelID = input.effectiveCategoryModel?.modelID ?? "?"
  const isFree = modelID.toLowerCase().includes("free")
  const cost = isFree ? "🆓" : ""

  const header = `✓ ${input.agentToUse} · ${modelID} ${cost} · ${duration}`

  return `${header}\n\n${input.textContent || "(No text output)"}\n\n${buildTaskMetadataBlock({
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
  const modelID = input.effectiveCategoryModel?.modelID ?? "?"
  const isFree = modelID.toLowerCase().includes("free")
  const cost = isFree ? "🆓" : ""
  const category = input.args.category ?? "auto"

  const header = `✓ ${input.agentToUse} · ${modelID} ${cost} · ${duration}`

  return `${header}\n\n${input.textContent || "(No text output)"}\n\n${buildTaskMetadataBlock({
    sessionId: input.activeSessionID,
    taskId: input.activeSessionID,
    agent: input.agentToUse,
    category: input.args.category,
  })}`
}
