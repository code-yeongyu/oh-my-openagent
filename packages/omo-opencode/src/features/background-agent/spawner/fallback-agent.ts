import { getAgentToolRestrictions } from "../../../shared"
import type { TaskPromptBody } from "./task-prompt-body"

export const FALLBACK_AGENT = "general"

export function isAgentNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return (
    message.includes("Agent not found") ||
    message.includes("agent.name")
  )
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export function buildFallbackBody(
  originalBody: TaskPromptBody,
  fallbackAgent: string,
  options: { includeTeamToolDenylist?: boolean } = {},
): TaskPromptBody {
  return {
    ...originalBody,
    agent: fallbackAgent,
    tools: {
      task: false,
      call_omo_agent: true,
      question: false,
      ...getAgentToolRestrictions(fallbackAgent, options),
    },
  }
}
