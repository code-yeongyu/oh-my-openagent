import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_AGENT_NAMES } from "./builtin/names"

/**
 * `categories.<name>` keys that equal a known agent name. A `task(subagent_type: <name>)` spawn never
 * reads `categories.*`; only `agents.<name>` reaches agent resolution, so such a key is silently dead
 * for that agent (#10323). Diagnose only: resolution does not alias the category onto the agent.
 * Builtin names come from a prompt-free list so the eager extension entry can call this.
 */
export function categoryShadowedAgentNames(config: OmoConfig, agentNames: Iterable<string> = []): readonly string[] {
  const agents = new Set([...BUILTIN_AGENT_NAMES, ...Object.keys(config.agents ?? {}), ...agentNames])
  // An agent that already sets its own chain is configured correctly; the category key is not shadowing
  // anything it relies on, so it gets no warning (and never a snippet that would overwrite that chain).
  // Only the agent's own key counts: omo.json agents are mapped by their key as written, so a chain
  // under a retired alias key never reaches the canonical agent and must not silence this warning.
  const ownsChain = (name: string): boolean => {
    const agent = config.agents?.[name]
    return agent?.model !== undefined || agent?.models !== undefined
  }
  return Object.keys(config.categories ?? {}).filter((name) => agents.has(name) && !ownsChain(name))
}

export function categoryShadowMessage(config: OmoConfig, name: string): string {
  const category = config.categories?.[name]
  const chain = category?.models ?? (category?.model === undefined ? undefined : [category.model])
  const value = chain === undefined ? "[...]" : JSON.stringify(chain)
  return `categories."${name}" is not read for subagent_type "${name}" spawns (categories only route task(category: ...)), so that agent runs its default model chain. Move the chain to the agent: "agents": { "${name}": { "models": ${value} } }. If you also use task(category: "${name}") on purpose, the key keeps working there; giving the agent its own models silences this warning`
}
