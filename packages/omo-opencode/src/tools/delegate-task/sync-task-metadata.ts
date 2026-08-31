import { publishToolMetadata } from "../../features/tool-metadata-store"
import type { ParentContext } from "./executor-types"
import { resolveMetadataModel } from "./resolve-metadata-model"
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export interface SyncTaskMetadataInput {
  readonly args: DelegateTaskArgs
  readonly currentSessionID: string
  readonly currentModel: DelegatedModelConfig | undefined
  readonly parentContext: ParentContext
  readonly agentToUse: string
  readonly spawnDepth: number
}

export function buildSyncTaskMetadataInput(input: SyncTaskMetadataInput): {
  title: string
  metadata: Record<string, unknown>
} {
  return {
    title: input.args.description,
    metadata: {
      prompt: input.args.prompt,
      agent: input.agentToUse,
      category: input.args.category,
      ...(input.args.requested_subagent_type !== undefined ? { requested_subagent_type: input.args.requested_subagent_type } : {}),
      load_skills: input.args.load_skills,
      description: input.args.description,
      run_in_background: input.args.run_in_background,
      taskId: input.currentSessionID,
      sessionId: input.currentSessionID,
      sync: true,
      spawnDepth: input.spawnDepth,
      command: input.args.command,
      model: resolveMetadataModel(input.currentModel, input.parentContext.model),
    },
  }
}

export async function publishSyncTaskMetadata(input: SyncTaskMetadataInput & {
  readonly ctx: ToolContextWithMetadata
}): Promise<void> {
  const payload = buildSyncTaskMetadataInput(input)
  await publishToolMetadata(input.ctx, payload)
}
