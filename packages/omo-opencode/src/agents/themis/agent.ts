import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"
import { buildThemisDefaultPrompt } from "./default"
import { buildThemisGptPrompt } from "./gpt"

const MODE = "subagent" as const

export function createThemisAgent(model: string): AgentConfig {
  const prompt = isGptModel(model) ? buildThemisGptPrompt() : buildThemisDefaultPrompt()

  return {
    description:
      "Formal deliberative reasoning agent. Uses ASPIC+ proof chains for option selection, trade-off closure, catastrophic-risk gating, and policy bundle generation. Invoke via /deliberate.",
    mode: MODE,
    model,
    maxTokens: 8192,
    prompt,
    color: "#000000",
    permission: {
      question: "allow",
      call_omo_agent: "deny",
    } as AgentConfig["permission"],
  }
}
createThemisAgent.mode = MODE

export const themisPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Themis",
  triggers: [
    {
      domain: "Deliberation",
      trigger: "Formal option selection or trade-off closure needed",
    },
    {
      domain: "Policy",
      trigger: "Competing options with constraints and preferences",
    },
    {
      domain: "Risk",
      trigger: "Catastrophic-risk gating or repair humility assessment",
    },
  ],
  useWhen: [
    "Comparing competing options formally",
    "Evaluating trade-offs under hard constraints",
    "Need a proof-chain-backed recommendation",
    "Policy or strategy disputes requiring ASPIC+ argumentation",
  ],
  avoidWhen: [
    "Simple file operations",
    "Architecture decisions (use Oracle)",
    "Plan review (use Momus)",
    "Implementation tasks (use Hephaestus)",
  ],
  keyTrigger: "Formal deliberation request",
}
