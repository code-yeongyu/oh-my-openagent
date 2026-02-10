import pc from "picocolors"
import type { RunOptions } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"

const CORE_AGENT_ORDER = ["sisyphus", "hephaestus", "prometheus", "atlas"] as const
const DEFAULT_AGENT = "sisyphus"

type EnvVars = Record<string, string | undefined>

const normalizeAgentName = (agent?: string): string | undefined => {
  if (!agent) return undefined
  const trimmed = agent.trim()
  if (!trimmed) return undefined
  const lowered = trimmed.toLowerCase()
  const coreMatch = CORE_AGENT_ORDER.find((name) => name.toLowerCase() === lowered)
  return coreMatch ?? trimmed
}

const isAgentDisabled = (agent: string, config: OhMyOpenCodeConfig): boolean => {
  const lowered = agent.toLowerCase()
  if (lowered === "sisyphus" && config.sisyphus_agent?.disabled === true) {
    return true
  }
  return (config.disabled_agents ?? []).some(
    (disabled) => disabled.toLowerCase() === lowered
  )
}

const pickFallbackAgent = (config: OhMyOpenCodeConfig): string => {
  for (const agent of CORE_AGENT_ORDER) {
    if (!isAgentDisabled(agent, config)) {
      return agent
    }
  }
  return DEFAULT_AGENT
}

export const resolveRunAgent = (
  options: RunOptions,
  pluginConfig: OhMyOpenCodeConfig,
  env: EnvVars = process.env
): string => {
  const cliAgent = normalizeAgentName(options.agent)
  const envAgent = normalizeAgentName(env.OPENCODE_DEFAULT_AGENT)
  const configAgent = normalizeAgentName(pluginConfig.default_run_agent)
  const resolved = cliAgent ?? envAgent ?? configAgent ?? DEFAULT_AGENT
  const normalized = normalizeAgentName(resolved) ?? DEFAULT_AGENT

  if (isAgentDisabled(normalized, pluginConfig)) {
    const fallback = pickFallbackAgent(pluginConfig)
    const fallbackDisabled = isAgentDisabled(fallback, pluginConfig)
    if (fallbackDisabled) {
      console.log(
        pc.yellow(
          `Requested agent "${normalized}" is disabled and no enabled core agent was found. Proceeding with "${fallback}".`
        )
      )
      return fallback
    }
    console.log(
      pc.yellow(
        `Requested agent "${normalized}" is disabled. Falling back to "${fallback}".`
      )
    )
    return fallback
  }

  return normalized
}
