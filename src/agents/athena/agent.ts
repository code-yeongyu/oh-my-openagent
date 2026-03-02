import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { ATHENA_INTERACTIVE_PROMPT } from "./interactive-prompt"

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
      trigger: "Need confirmation-gated delegation after synthesizing council findings",
    },
  ],
  useWhen: [
    "You need Athena to synthesize multi-model council outputs into concrete findings",
    "You need agreement-level confidence before selecting what to execute next",
    "You need explicit user confirmation before delegating fixes to Atlas or planning to Prometheus",
  ],
  avoidWhen: [
    "Single-model questions that do not need council synthesis",
    "Tasks requiring direct implementation by Athena",
    "Non-interactive/programmatic council invocation (use athena-junior instead)",
  ],
}

export function createAthenaAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(["call_omo_agent"])

  return {
    description:
      "Primary synthesis strategist for multi-model council outputs. Produces evidence-grounded findings and runs confirmation-gated delegation via switch_agent (Prometheus planning, Atlas fixes, or direct implementation agents where runtime guidance requires). (Athena - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    permission: restrictions.permission,
    prompt: ATHENA_INTERACTIVE_PROMPT,
    color: "#1F8EFA",
  }
}
createAthenaAgent.mode = MODE
