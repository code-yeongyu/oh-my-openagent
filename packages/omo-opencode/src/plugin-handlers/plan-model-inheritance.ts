const MODEL_SETTINGS_KEYS = [
  "model",
  "variant",
  "temperature",
  "top_p",
  "maxTokens",
  "thinking",
  "reasoningEffort",
  "textVerbosity",
  "providerOptions",
  "fallback_models",
] as const

export function buildPlanDemoteConfig(
  prometheusConfig: Record<string, unknown> | undefined,
  planOverride: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const modelSettings: Record<string, unknown> = {}

  for (const key of MODEL_SETTINGS_KEYS) {
    const value = planOverride?.[key] ?? prometheusConfig?.[key]
    if (value !== undefined) {
      modelSettings[key] = value
    }
  }

  return { mode: "subagent" as const, hidden: true, ...modelSettings }
}

/**
 * Minimal model settings that `sisyphus_agent.inherit_model` propagates. Only
 * `model` and `variant` are copied in v1: pushing Sisyphus's `maxTokens`,
 * reasoning, or provider options onto cheap research subagents would be
 * surprising and costly.
 * provider options onto cheap research subagents would be surprising and costly.
 */
export type InheritableModelSettings = {
  model?: unknown
  variant?: unknown
}

/**
 * Opt-in `sisyphus_agent.inherit_model`: copy Sisyphus's resolved `model` and
 * `variant` onto eligible builtin subagents, in place.
 *
 * Precedence, per agent:
 * 1. An explicit per-agent `model` or `category` wins (the user already chose).
 * 2. An agent with a hard model/provider requirement, or one the caller marks as
 *    blocked, keeps its own resolution (e.g. Hephaestus needs a GPT provider,
 *    multimodal-looker needs a vision model).
 * 3. Otherwise the agent inherits Sisyphus's `model` (+ `variant`).
 *
 * `variant` is kept coherent with the inherited `model`: it is set when Sisyphus
 * has one, and cleared otherwise so the new model falls back to its own default.
 */
export function applyInheritFromSisyphus(input: {
  agents: Record<string, unknown>
  sisyphus: InheritableModelSettings | undefined
  eligibleAgentNames: readonly string[]
  isBlocked: (agentName: string) => boolean
  getUserOverride: (agentName: string) => { model?: unknown; category?: unknown } | undefined
}): void {
  const { agents, sisyphus, eligibleAgentNames, isBlocked, getUserOverride } = input
  if (!sisyphus || sisyphus.model === undefined) return

  for (const agentName of eligibleAgentNames) {
    if (isBlocked(agentName)) continue

    const override = getUserOverride(agentName)
    if (override?.model !== undefined) continue
    if (override?.category !== undefined) continue

    const target = agents[agentName]
    if (typeof target !== "object" || target === null) continue

    const agentConfig = target as Record<string, unknown>
    agentConfig.model = sisyphus.model
    if (sisyphus.variant !== undefined) {
      agentConfig.variant = sisyphus.variant
    } else {
      delete agentConfig.variant
    }
  }
}
