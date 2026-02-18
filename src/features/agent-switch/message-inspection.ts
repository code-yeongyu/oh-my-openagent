import { getAgentConfigKey } from "../../shared/agent-display-names"

export interface MessageRoleAgent {
  role: string
  agent: string
}

export function extractMessageList(response: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(response)) {
    return response.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  }
  if (typeof response === "object" && response !== null) {
    const data = (response as Record<string, unknown>).data
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    }
  }
  return []
}

function getRoleAgent(message: Record<string, unknown>): MessageRoleAgent | undefined {
  const info = message.info
  if (typeof info !== "object" || info === null) {
    return undefined
  }

  const role = (info as Record<string, unknown>).role
  const agent = (info as Record<string, unknown>).agent
  if (typeof role !== "string" || typeof agent !== "string") {
    return undefined
  }

  return { role, agent }
}

export function getLatestUserAgent(messages: Array<Record<string, unknown>>): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    const roleAgent = getRoleAgent(message)
    if (!roleAgent || roleAgent.role !== "user") {
      continue
    }

    return roleAgent.agent
  }

  return undefined
}

export function hasRecentUserTurnForTargetAgent(args: {
  messages: Array<Record<string, unknown>>
  targetAgent: string
  lookback?: number
}): boolean {
  const { messages, targetAgent, lookback = 8 } = args
  const targetKey = getAgentConfigKey(targetAgent)
  const start = Math.max(0, messages.length - lookback)

  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    const roleAgent = getRoleAgent(message)
    if (!roleAgent || roleAgent.role !== "user") {
      continue
    }

    if (getAgentConfigKey(roleAgent.agent) === targetKey) {
      return true
    }
  }

  return false
}

export function hasNewUserTurnForTargetAgent(args: {
  messages: Array<Record<string, unknown>>
  targetAgent: string
  baselineCount: number
}): boolean {
  const { messages, targetAgent, baselineCount } = args
  const targetKey = getAgentConfigKey(targetAgent)

  if (messages.length <= baselineCount) {
    return false
  }

  const newMessages = messages.slice(Math.max(0, baselineCount))
  for (const message of newMessages) {
    const roleAgent = getRoleAgent(message)
    if (!roleAgent || roleAgent.role !== "user") {
      continue
    }

    if (getAgentConfigKey(roleAgent.agent) === targetKey) {
      return true
    }
  }

  return false
}
