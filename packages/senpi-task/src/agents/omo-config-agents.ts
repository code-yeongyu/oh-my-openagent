import type { OmoAgentDef, OmoConfig } from "@oh-my-opencode/omo-config-core"

import { canonicalAgentName } from "./legacy-agent-names"
import { normalizeToolRules } from "./tools"
import type { AgentDefinition } from "./types"

/**
 * Bridge the already-loaded `omo.json` agents (the omo-config-core `OmoAgentDef` shape) onto senpi-task
 * `AgentDefinition`s so `subagent_type` spawns and team membership can address user-defined agents.
 *
 * The two shapes differ structurally: `OmoAgentDef` keys the agent by its record name, uses snake_case
 * (`execution_mode`, `max_depth`, `allowed_subagents`), and expresses tools as a `{ name: boolean }`
 * record; `AgentDefinition` carries an explicit `name`, camelCase keys, and last-match-wins tool rules.
 * This maps each field across, reusing the tool-rule normalizer, and omits any field the source omits.
 *
 * A legacy curated record key maps onto its canonical key (`plan-consultant`/
 * `plan-reviewer`), and the canonical key wins when both exist. Every `allowed_subagents` entry is
 * canonicalized so `manager/depth-policy.ts` compares against the canonical target id.
 */
export function mapOmoConfigAgents(config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  const source = config.agents ?? {}
  const agents: Record<string, AgentDefinition> = {}
  for (const [name, def] of Object.entries(source)) {
    const canonical = canonicalAgentName(name)
    if (canonical.legacy !== undefined && source[canonical.name] !== undefined) {
      continue
    }
    agents[canonical.name] = toAgentDefinition(canonical.name, def)
  }
  return agents
}

/**
 * The legacy omo.json agent keys present in a config, paired with their canonical keys and sorted by
 * legacy key. A legacy key whose canonical key is also configured is still listed (the canonical
 * definition wins in `mapOmoConfigAgents`) so callers can surface the deprecation either way.
 */
export function legacyOmoConfigAgentKeys(
  config: OmoConfig,
): readonly { readonly legacy: string; readonly canonical: string }[] {
  const source = config.agents ?? {}
  return Object.keys(source)
    .map((name) => canonicalAgentName(name))
    .filter((canonical): canonical is { readonly name: string; readonly legacy: string } =>
      canonical.legacy !== undefined
    )
    .map((canonical) => ({ legacy: canonical.legacy, canonical: canonical.name }))
    .sort((a, b) => (a.legacy < b.legacy ? -1 : a.legacy > b.legacy ? 1 : 0))
}

function toAgentDefinition(name: string, def: OmoAgentDef): AgentDefinition {
  const tools = normalizeToolRules(def.tools)
  return {
    name,
    ...(def.description === undefined ? {} : { description: def.description }),
    ...(def.prompt === undefined ? {} : { prompt: def.prompt }),
    ...(def.model === undefined ? {} : { model: def.model }),
    ...(def.models === undefined ? {} : { models: def.models }),
    ...(def.variant === undefined ? {} : { variant: def.variant }),
    ...(def.reasoning === undefined && def.reasoningEffort === undefined ? {} : { reasoningEffort: def.reasoning ?? def.reasoningEffort }),
    ...(def.temperature === undefined ? {} : { temperature: def.temperature }),
    ...(tools === undefined ? {} : { tools }),
    ...(def.disable === undefined ? {} : { disable: def.disable }),
    ...(def.background === undefined ? {} : { background: def.background }),
    ...(def.execution_mode === undefined ? {} : { executionMode: def.execution_mode }),
    ...(def.allowed_subagents === undefined
      ? {}
      : { allowedSubagents: def.allowed_subagents.map((entry) => canonicalAgentName(entry).name) }),
    ...(def.disallowed_tools === undefined ? {} : { disallowedTools: def.disallowed_tools }),
    ...(def.max_depth === undefined ? {} : { maxDepth: def.max_depth }),
    ...(def.max_turns === undefined ? {} : { maxTurns: def.max_turns }),
  }
}
