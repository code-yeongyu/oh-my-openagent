import { createInternalAgentTextPart, getAgentToolRestrictions } from "../../../shared"
import type { LaunchInput, UserToolPermission } from "../types"

type PromptModel = LaunchInput["model"]

type TaskPromptBodyOptions =
  | {
      readonly kind: "launch"
      readonly agent: string
      readonly model: PromptModel
      readonly system: LaunchInput["skillContent"]
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
      readonly userPermission?: UserToolPermission
    }
  | {
      readonly kind: "resume"
      readonly agent: string
      readonly model: PromptModel
      readonly prompt: string
      readonly includeTeamToolDenylist: boolean
      readonly userPermission?: UserToolPermission
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

export function buildUserDeniedTools(
  permission: UserToolPermission | undefined,
): Record<string, boolean> {
  const deniedTools: Record<string, boolean> = {}
  if (!permission) return deniedTools

  for (const [tool, value] of Object.entries(permission)) {
    if (value === "deny") deniedTools[tool] = false
  }
  return deniedTools
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
      call_omo_agent: true,
      question: false,
      ...buildUserDeniedTools(options.userPermission),
      ...getAgentToolRestrictions(options.agent, {
        includeTeamToolDenylist: options.includeTeamToolDenylist,
      }),
    },
    parts: [createInternalAgentTextPart(options.prompt)],
  }
}
