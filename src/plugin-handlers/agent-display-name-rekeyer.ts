import { log } from "../shared"
import {
  initializeAgentNameAliases,
  getCanonicalToRegisteredMap,
} from "../shared/agent-name-aliases"

export function rekeyAgentsByDisplayNames(params: {
  config: Record<string, unknown>
  agentResult: Record<string, unknown>
  displayNames: Record<string, string> | undefined
}): void {
  const { config, agentResult, displayNames } = params

  if (!displayNames || Object.keys(displayNames).length === 0) return

  const { warnings } = initializeAgentNameAliases(
    displayNames,
    Object.keys(agentResult),
  )

  for (const warning of warnings) {
    log(warning)
  }

  const canonicalToRegistered = getCanonicalToRegisteredMap()
  const agentMap = config.agent as Record<string, unknown> | undefined

  for (const [canonical, registered] of canonicalToRegistered) {
    if (agentResult[canonical] !== undefined) {
      agentResult[registered] = agentResult[canonical]
      delete agentResult[canonical]
    }

    if (agentMap && agentMap[canonical] !== undefined) {
      agentMap[registered] = agentMap[canonical]
      delete agentMap[canonical]
    }

    if (config.default_agent === canonical) {
      config.default_agent = registered
    }
  }
}
