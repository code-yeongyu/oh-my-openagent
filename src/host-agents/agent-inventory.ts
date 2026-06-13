import { createExploreAgent } from "../agents/explore"
import { createHephaestusAgent } from "../agents/hephaestus"
import { createLibrarianAgent } from "../agents/librarian"
import { createMetisAgent } from "../agents/metis"
import { createMomusAgent } from "../agents/momus"
import { createMultimodalLookerAgent } from "../agents/multimodal-looker"
import { createOracleAgent } from "../agents/oracle"
import { getPrometheusPrompt } from "../agents/prometheus"
import { createSisyphusAgent } from "../agents/sisyphus"
import { createSisyphusJuniorAgentWithOverrides } from "../agents/sisyphus-junior"
import { getAtlasPrompt } from "../agents/atlas/agent"
import { getAgentDisplayName } from "../shared/agent-display-names"
import { DEFAULT_AGENT_ORDER } from "../shared/agent-ordering"
import { AGENT_ELIGIBILITY_REGISTRY } from "../features/team-mode/types"

export type TargetAgentPolicy = "full" | "read-only" | "prometheus-markdown-only"

export type TargetAgentDefinition = {
  name: string
  displayName: string
  description: string
  systemPrompt: string
  policy: TargetAgentPolicy
  tools?: readonly string[]
  teamEligibility: "eligible" | "conditional" | "hard-reject"
}

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const
const PROMETHEUS_TOOLS = [...READ_ONLY_TOOLS, "write", "edit"] as const

function definition(
  name: string,
  config: { description?: string; prompt?: string },
  policy: TargetAgentPolicy,
): TargetAgentDefinition {
  return {
    name,
    displayName: getAgentDisplayName(name),
    description: config.description ?? `${getAgentDisplayName(name)} agent`,
    systemPrompt: config.prompt ?? "",
    policy,
    tools: policy === "full" ? undefined : policy === "prometheus-markdown-only" ? PROMETHEUS_TOOLS : READ_ONLY_TOOLS,
    teamEligibility: AGENT_ELIGIBILITY_REGISTRY[name]?.verdict ?? "hard-reject",
  }
}

function createDefinitions(): TargetAgentDefinition[] {
  const defaultModel = "anthropic/claude-sonnet-4-6"
  const core = [
    definition("sisyphus", createSisyphusAgent(defaultModel), "full"),
    definition("hephaestus", createHephaestusAgent("openai/gpt-5.5"), "full"),
    definition(
      "prometheus",
      {
        description: "Strategic plan builder restricted to planning work.",
        prompt: getPrometheusPrompt(defaultModel),
      },
      "prometheus-markdown-only",
    ),
    definition(
      "atlas",
      {
        description: "Plan executor and multi-agent orchestrator.",
        prompt: getAtlasPrompt(defaultModel),
      },
      "full",
    ),
  ]
  const remaining = [
    definition("sisyphus-junior", createSisyphusJuniorAgentWithOverrides(undefined, defaultModel), "full"),
    definition("metis", createMetisAgent(defaultModel), "read-only"),
    definition("momus", createMomusAgent(defaultModel), "read-only"),
    definition("oracle", createOracleAgent(defaultModel), "read-only"),
    definition("librarian", createLibrarianAgent(defaultModel), "read-only"),
    definition("explore", createExploreAgent(defaultModel), "read-only"),
    definition("multimodal-looker", createMultimodalLookerAgent(defaultModel), "read-only"),
  ]
  return [...core, ...remaining]
}

export const TARGET_AGENT_NAMES = [
  ...DEFAULT_AGENT_ORDER,
  "sisyphus-junior",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
] as const

export function createTargetAgentInventory(): readonly TargetAgentDefinition[] {
  const definitions = new Map(createDefinitions().map((agent) => [agent.name, agent]))
  return TARGET_AGENT_NAMES.map((name) => {
    const agent = definitions.get(name)
    if (!agent) throw new Error(`Missing target agent definition: ${name}`)
    return agent
  })
}
