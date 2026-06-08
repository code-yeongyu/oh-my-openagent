import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentListDisplayName } from "./agent-display-names"

export const DEFAULT_AGENT_ORDER = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
] as const

export type AgentOrderValidation = {
  order: string[]
  invalid: string[]
  duplicates: string[]
}

const KNOWN_AGENT_KEYS = new Set(Object.keys(AGENT_DISPLAY_NAMES))

function appendUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value)
  }
}

export function validateAgentOrder(agentOrder: readonly string[] | undefined): AgentOrderValidation {
  const order: string[] = []
  const invalid: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const rawName of agentOrder ?? []) {
    const trimmed = rawName.trim()
    if (trimmed.length === 0) {
      invalid.push(rawName)
      continue
    }

    const configKey = getAgentConfigKey(trimmed)
    if (!KNOWN_AGENT_KEYS.has(configKey)) {
      invalid.push(rawName)
      continue
    }

    if (seen.has(configKey)) {
      duplicates.push(rawName)
      continue
    }

    seen.add(configKey)
    order.push(configKey)
  }

  for (const configKey of DEFAULT_AGENT_ORDER) {
    appendUnique(order, configKey)
  }

  return { order, invalid, duplicates }
}

export function resolveAgentOrderDisplayNames(agentOrder: readonly string[] | undefined): string[] {
  return validateAgentOrder(agentOrder).order.map((configKey) => getAgentListDisplayName(configKey))
}
