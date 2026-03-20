import pc from "picocolors"
import type { RunOptions } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"
import { getAgentConfigKey, getAgentDisplayName } from "../../shared/agent-display-names"

const CORE_AGENT_ORDER = ["sisyphus", "hephaestus", "prometheus", "atlas"] as const
const DEFAULT_AGENT = "sisyphus"

type EnvVars = Record<string, string | undefined>
type CoreAgentKey = (typeof CORE_AGENT_ORDER)[number]

interface ResolvedAgent {
  configKey: string
  resolvedName: string
}

const normalizeAgentName = (agent?: string): ResolvedAgent | undefined => {
  if (!agent) return undefined
  const trimmed = agent.trim()
  if (trimmed.length === 0) return undefined

  const configKey = getAgentConfigKey(trimmed)
  const displayName = getAgentDisplayName(configKey)
  const isKnownAgent = displayName !== configKey

  return {
    configKey,
    resolvedName: isKnownAgent ? displayName : trimmed,
  }
}

const isAgentDisabled = (agentConfigKey: string, config: OhMyOpenCodeConfig): boolean => {
  const lowered = agentConfigKey.toLowerCase()
  if (lowered === DEFAULT_AGENT && config.sisyphus_agent?.disabled === true) {
    return true
  }
  return (config.disabled_agents ?? []).some(
    (disabled) => getAgentConfigKey(disabled) === lowered
  )
}

const pickFallbackAgent = (config: OhMyOpenCodeConfig): CoreAgentKey => {
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
  const resolved =
    cliAgent ??
    envAgent ??
    configAgent ?? {
      configKey: DEFAULT_AGENT,
      resolvedName: getAgentDisplayName(DEFAULT_AGENT),
    }

  if (isAgentDisabled(resolved.configKey, pluginConfig)) {
    const fallback = pickFallbackAgent(pluginConfig)
    const fallbackName = getAgentDisplayName(fallback)
    const fallbackDisabled = isAgentDisabled(fallback, pluginConfig)
    if (fallbackDisabled) {
      console.log(
        pc.yellow(
          `Requested agent "${resolved.resolvedName}" is disabled and no enabled core agent was found. Proceeding with "${fallbackName}".`
        )
      )
      return fallbackName
    }
    console.log(
      pc.yellow(
        `Requested agent "${resolved.resolvedName}" is disabled. Falling back to "${fallbackName}".`
      )
    )
    return fallbackName
  }

  return resolved.resolvedName
}
