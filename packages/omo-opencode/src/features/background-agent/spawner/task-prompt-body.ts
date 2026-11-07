import { createInternalAgentTextPart, getAgentToolRestrictions } from "../../../shared"
import { canUseCallOmoAgent } from "../../../shared/delegated-agent-tool-policy"
import type { LaunchInput } from "../types"

type PromptModel = LaunchInput["model"]

type TaskPromptBodyOptions =
  | {
      readonly kind: "launch"
      readonly agent: string
      readonly model: PromptModel
      readonly inheritedModel?: LaunchInput["parentModel"]
      readonly system: LaunchInput["skillContent"]
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
    }
  | {
      readonly kind: "resume"
      readonly agent: string
      readonly model: PromptModel
      readonly inheritedModel?: LaunchInput["parentModel"]
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
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
    tools: {
      task: false,
      call_omo_agent: canUseCallOmoAgent(options.model, options.inheritedModel),
      question: false,
      ...getAgentToolRestrictions(options.agent, {
        includeTeamToolDenylist: options.includeTeamToolDenylist,
      }),
    },
    parts: [createInternalAgentTextPart(options.prompt)],
  }
}
