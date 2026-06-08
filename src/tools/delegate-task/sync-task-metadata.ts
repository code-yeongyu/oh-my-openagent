import { publishToolMetadata } from "../../features/tool-metadata-store"
import type { ParentContext } from "./executor-types"
import { resolveMetadataModel } from "./resolve-metadata-model"
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types"

export async function publishSyncTaskMetadata(input: {
  readonly args: DelegateTaskArgs
  readonly ctx: ToolContextWithMetadata
  readonly currentSessionID: string
  readonly currentModel: DelegatedModelConfig | undefined
  readonly parentContext: ParentContext
  readonly agentToUse: string
  readonly spawnDepth: number
}): Promise<void> {
  await publishToolMetadata(input.ctx, {
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
  })
}
