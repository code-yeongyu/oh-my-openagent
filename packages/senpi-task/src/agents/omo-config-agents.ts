import type { OmoAgentDef, OmoConfig } from "@oh-my-opencode/omo-config-core"

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
 */
export function mapOmoConfigAgents(config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  const agents: Record<string, AgentDefinition> = {}
  for (const [name, def] of Object.entries(config.agents ?? {})) {
    agents[name] = toAgentDefinition(name, def)
  }
  return agents
}

function toAgentDefinition(name: string, def: OmoAgentDef): AgentDefinition {
  const tools = normalizeToolRules(def.tools)
  return {
    name,
    ...(def.description === undefined ? {} : { description: def.description }),
    ...(def.prompt === undefined ? {} : { prompt: def.prompt }),
    ...(def.model === undefined ? {} : { model: def.model }),
    ...(def.models === undefined ? {} : { models: def.models }),
    ...(def.temperature === undefined ? {} : { temperature: def.temperature }),
    ...(tools === undefined ? {} : { tools }),
    ...(def.disable === undefined ? {} : { disable: def.disable }),
    ...(def.background === undefined ? {} : { background: def.background }),
    ...(def.execution_mode === undefined ? {} : { executionMode: def.execution_mode }),
    ...(def.allowed_subagents === undefined ? {} : { allowedSubagents: def.allowed_subagents }),
    ...(def.max_depth === undefined ? {} : { maxDepth: def.max_depth }),
  }
}
