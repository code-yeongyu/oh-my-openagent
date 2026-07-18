import type { OmoConfigSource } from "@oh-my-opencode/omo-config-core"

// Fixed, tested warning text (Metis #17): when a project carries BOTH an opencode-family config and
// an omo.json with categories/agents, senpi reads omo.json ONLY. Emitted once on the first
// session_start through the captured UI, with a logger fallback when headless.
export const DUAL_CONFIG_WARNING =
  "omo-senpi: both an opencode-family config and .omo/omo.json define categories/agents. senpi reads .omo/omo.json only; the opencode config is ignored for tasks."

export interface CoexistenceInput {
  readonly sources: readonly OmoConfigSource[]
  readonly hasOpencodeConfig: boolean
}

// True when the loaded omo.json actually contributed AND an opencode-family config is also present -
// the only case where a user could be surprised that senpi ignored the opencode config.
export function shouldWarnDualConfig(input: CoexistenceInput): boolean {
  if (!input.hasOpencodeConfig) return false
  return input.sources.some((source) => source.loaded)
}
