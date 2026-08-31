import { buildAgentSpawnTools, createInternalAgentTextPart, type AgentSpawnUserPermission } from "../../../shared"
import type { LaunchInput } from "../types"

type PromptModel = LaunchInput["model"]

type TaskPromptBodyOptions =
  | {
      readonly kind: "launch"
      readonly agent: string
      readonly model: PromptModel
      readonly system: LaunchInput["skillContent"]
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
      readonly userPermission?: AgentSpawnUserPermission
    }
  | {
      readonly kind: "resume"
      readonly agent: string
      readonly model: PromptModel
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
      readonly userPermission?: AgentSpawnUserPermission
    }

export type TaskPromptBody = {
  readonly agent: string
  readonly model?: {
    readonly providerID: string
    readonly modelID: string
  }
  readonly variant?: string
  readonly system?: string | undefined
  readonly tools: Record<string, boolean>
  readonly parts: Array<{
    readonly type: "text"
    readonly text: string
    readonly synthetic?: boolean
  }>
}

export function buildTaskPromptBody(options: TaskPromptBodyOptions): TaskPromptBody {
  const promptModel = options.model
    ? {
        providerID: options.model.providerID,
        modelID: options.model.modelID,
      }
    : undefined
  const promptVariant = options.model?.variant

  return {
    agent: options.agent,
    ...(promptModel ? { model: promptModel } : {}),
    ...(promptVariant ? { variant: promptVariant } : {}),
    ...(options.kind === "launch" ? { system: options.system } : {}),
    tools: buildAgentSpawnTools(options.agent, options.userPermission, {
      includeTeamToolDenylist: options.includeTeamToolDenylist,
    }),
    parts: [createInternalAgentTextPart(options.prompt)],
  }
}
