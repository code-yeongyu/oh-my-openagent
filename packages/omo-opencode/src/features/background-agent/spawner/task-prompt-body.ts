import { createInternalAgentTextPart, getAgentToolRestrictions } from "../../../shared"
import { mergeDelegatePromptTools } from "../../../shared/delegate-tool-overrides"
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
      readonly categoryTools?: Record<string, boolean>
    }
  | {
      readonly kind: "resume"
      readonly agent: string
      readonly model: PromptModel
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
  readonly parts: readonly [{
    readonly type: "text"
    readonly text: string
  }]
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
    tools: mergeDelegatePromptTools({
      defaults: {
        task: false,
        call_omo_agent: true,
        question: false,
      },
      configuredTools: options.kind === "launch" ? options.categoryTools : undefined,
      hardRestrictions: getAgentToolRestrictions(options.agent, {
        includeTeamToolDenylist: options.includeTeamToolDenylist,
      }),
    }),
    parts: [createInternalAgentTextPart(options.prompt)],
  }
}
