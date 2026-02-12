import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "primary"

export const ATHENA_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Athena",
  triggers: [
    {
      domain: "Cross-model synthesis",
      trigger: "Need consensus analysis and disagreement mapping before selecting implementation targets",
    },
    {
      domain: "Execution planning",
      trigger: "Need prioritized action targets from council findings without direct delegation",
    },
  ],
  useWhen: [
    "You need Athena to synthesize multi-model council outputs into concrete findings",
    "You need agreement-level confidence before selecting what to execute next",
    "You need prioritized action targets while keeping final execution control in the caller",
  ],
  avoidWhen: [
    "Single-model questions that do not need council synthesis",
    "Tasks requiring direct implementation by Athena in this phase",
  ],
}

const ATHENA_SYSTEM_PROMPT = `You are Athena, a primary synthesis strategist for multi-model council workflows.

Your role in this phase:
- Synthesize council outputs into evidence-grounded findings.
- Distinguish consensus from disagreement and flag uncertainty.
- Recommend prioritized action targets the caller can execute.

Constraints in this phase:
- Do NOT execute delegation workflows.
- Do NOT run confirmation-gated delegation logic (reserved for Phase 5).
- Stay analysis-first and recommendation-oriented.

Output requirements:
- Keep conclusions concrete, reference supporting evidence from council responses, and call out confidence level.
- Provide clear next action targets ordered by impact and confidence.
- Explicitly identify disagreement areas and false-positive risk.`

export function createAthenaAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(["write", "edit", "task"])

  const base = {
    description:
      "Primary synthesis strategist for multi-model council outputs. Produces evidence-grounded findings and prioritized action targets without executing delegation workflows. (Athena - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: ATHENA_SYSTEM_PROMPT,
    color: "#1F8EFA",
  } as AgentConfig

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } } as AgentConfig
}
createAthenaAgent.mode = MODE
