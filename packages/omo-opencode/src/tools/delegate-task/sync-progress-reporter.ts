import { publishToolMetadata } from "../../features/tool-metadata-store"
import type { ParentContext, SessionMessage } from "./executor-types"
import { buildSyncTaskMetadataInput } from "./sync-task-metadata"
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export interface SyncTaskProgressSnapshot {
  readonly elapsedMs: number
  readonly assistantTurns: number
  readonly toolCalls: number
  readonly latestTool: string | undefined
}

/**
 * Summarize the child transcript's observable activity for live progress reporting.
 * Pure: counts assistant turns and tool parts, and derives the most recent tool name
 * (opencode ToolPart carries the tool name at the top level of the part).
 */
export function extractProgressActivity(messages: readonly SessionMessage[]): Omit<SyncTaskProgressSnapshot, "elapsedMs"> {
  let assistantTurns = 0
  let toolCalls = 0
  let latestTool: string | undefined
  for (const message of messages) {
    if (message.info?.role === "assistant") assistantTurns++
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") continue
      toolCalls++
      if (part.tool) latestTool = part.tool
    }
  }
  return { assistantTurns, toolCalls, latestTool }
}

export type SyncProgressPublisher = (snapshot: SyncTaskProgressSnapshot) => Promise<void>

/**
 * Build the onProgress callback wired into pollSyncSession. Each invocation republishes
 * the full sync task metadata (fresh session/model per call so fallback retries stay
 * consistent) merged with the current progress snapshot, via ctx.metadata() — the same
 * live-update seam native OpenCode tools use to stream progress into the parent TUI.
 */
export function createSyncProgressPublisher(input: {
  readonly ctx: ToolContextWithMetadata
  readonly args: DelegateTaskArgs
  readonly agentToUse: string
  readonly parentContext: ParentContext
  readonly getSessionID: () => string
  readonly getModel: () => DelegatedModelConfig | undefined
  readonly getSpawnDepth: () => number
}): SyncProgressPublisher {
  return async (snapshot) => {
    const payload = buildSyncTaskMetadataInput({
      args: input.args,
      currentSessionID: input.getSessionID(),
      currentModel: input.getModel(),
      parentContext: input.parentContext,
      agentToUse: input.agentToUse,
      spawnDepth: input.getSpawnDepth(),
    })
    await publishToolMetadata(input.ctx, {
      title: payload.title,
      metadata: { ...payload.metadata, progress: { ...snapshot } },
    })
  }
}
