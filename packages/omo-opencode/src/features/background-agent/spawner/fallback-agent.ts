import { getAgentToolRestrictions } from "../../../shared"

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
  originalBody: Record<string, unknown>,
  fallbackAgent: string,
  options: { includeTeamToolDenylist?: boolean } = {},
): Record<string, unknown> {
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
