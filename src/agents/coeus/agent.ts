import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { COEUS_SYSTEM_PROMPT } from "./system-prompt"

const MODE: AgentMode = "all"

const coeusRestrictions = createAgentToolRestrictions(["write", "edit"])

export function createCoeusAgent(model: string): AgentConfig {
  return {
    description:
      "Recursive divide-and-conquer planner that decomposes complex problems into domain-specific sub-plans via Sub-Prometheus agents. (Coeus - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...coeusRestrictions,
    prompt: COEUS_SYSTEM_PROMPT,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}
createCoeusAgent.mode = MODE

export const coeusPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  triggers: [
    {
      domain: "Large-scale planning",
      trigger:
        "Complex multi-domain tasks requiring recursive decomposition",
    },
  ],
  useWhen: [
    "Task spans 3+ architectural domains",
    "Complexity score >= 40",
    "Single Prometheus would produce 30+ tasks",
  ],
  avoidWhen: [
    "Simple single-domain tasks",
    "Complexity score < 40",
    "Task fits in one Prometheus session",
  ],
  promptAlias: "Coeus",
  keyTrigger:
    "Multi-domain complexity → Coeus decomposes, Sub-Prometheus plans each domain",
}
