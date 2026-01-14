import type { OhMyOpenCodeConfig } from "../config"

export function resolveAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName?: string
): string | undefined {
  if (!agentName) {
    return undefined
  }

  const agentOverrides = config.agents as
    | Record<string, { variant?: string; category?: string }>
    | undefined
  const agentOverride = agentOverrides?.[agentName]
  if (!agentOverride) {
    return undefined
  }

  if (agentOverride.variant) {
    return agentOverride.variant
  }

  const categoryName = agentOverride.category
  if (!categoryName) {
    return undefined
  }

  return config.categories?.[categoryName]?.variant
}

export function applyAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName: string | undefined,
  message: { variant?: string }
): void {
  const variant = resolveAgentVariant(config, agentName)
  if (variant !== undefined && message.variant === undefined) {
    message.variant = variant
  }
}
