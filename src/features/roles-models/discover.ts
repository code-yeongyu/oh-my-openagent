import type { OhMyOpenCodeConfig, AgentOverrideConfig } from "../../config"
import type { ChainEntry, Role } from "./types"

const KNOWN_ROLE_NAMES: ReadonlyArray<string> = [
  "sisyphus",
  "sisyphus-junior",
  "hephaestus",
  "prometheus",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "atlas",
  "OpenCode-Builder",
  "build",
  "plan",
]

function toChainEntry(model: string | undefined, variant?: string): ChainEntry | undefined {
  if (!model) return undefined
  return variant ? { model, variant } : { model }
}

function buildChain(override: AgentOverrideConfig | undefined): ChainEntry[] {
  if (!override?.fallback_models) return []
  return override.fallback_models
    .map((entry) => toChainEntry(entry.model, entry.variant))
    .filter((entry): entry is ChainEntry => entry !== undefined)
}

export function discoverRoles(config: OhMyOpenCodeConfig | undefined): Role[] {
  const agents = config?.agents
  if (!agents) {
    return KNOWN_ROLE_NAMES.map((name) => ({ name, chain: [] }))
  }

  return KNOWN_ROLE_NAMES.map((name) => {
    const override = (agents as Record<string, AgentOverrideConfig | undefined>)[name]
    return {
      name,
      primary: toChainEntry(override?.model, override?.variant),
      chain: buildChain(override),
    }
  })
}
