import type { HostKind } from "../host-contract"
import { createTargetAgentInventory, type TargetAgentDefinition } from "./agent-inventory"
import { createTargetCategoryInventory } from "./category-inventory"

export type TargetAgentRouteRequest = {
  subagentType?: string
  category?: string
  prompt: string
}

export type TargetAgentRoute = {
  host: Exclude<HostKind, "opencode">
  agent: TargetAgentDefinition
  prompt: string
  category?: string
}

export function resolveTargetAgentRoute(
  host: Exclude<HostKind, "opencode">,
  request: TargetAgentRouteRequest,
): TargetAgentRoute {
  const agents = createTargetAgentInventory()
  if (request.subagentType) {
    const agent = agents.find((candidate) => candidate.name === request.subagentType)
    if (!agent) throw new Error(`Unknown OMO agent "${request.subagentType}". Available: ${agents.map((item) => item.name).join(", ")}`)
    return { host, agent, prompt: request.prompt }
  }

  if (request.category) {
    const category = createTargetCategoryInventory().find((candidate) => candidate.name === request.category)
    if (!category) throw new Error(`Unknown OMO category "${request.category}".`)
    const agent = agents.find((candidate) => candidate.name === "sisyphus-junior")
    if (!agent) throw new Error("Missing target sisyphus-junior route")
    return {
      host,
      agent,
      category: category.name,
      prompt: `${category.promptAppend}\n\n${request.prompt}`,
    }
  }

  throw new Error("Delegation requires subagent_type or category.")
}
