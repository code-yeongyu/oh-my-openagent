import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { ATHENA_INTERACTIVE_PROMPT } from "./interactive-prompt"

const MODE: AgentMode = "primary"


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

export const ATHENA_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Athena",
  triggers: [
    {
      domain: "Multi-model council analysis",
      trigger: "Architecture decisions, tradeoff evaluation, or design review needing diverse model perspectives — interactive session with user confirmation"
    },
  ],
  useWhen: [
    "User asks 'should we', 'compare', 'evaluate', 'tradeoffs', 'what do you think about'",
    "Architectural decisions with long-term implications where model disagreement matters",
    "Design reviews benefiting from diverse model perspectives",
  ],
  avoidWhen: [
    "Implementation tasks — Athena cannot edit code (use Hephaestus/Sisyphus/Atlas)",
    "Simple factual questions with one correct answer",
    "Subtasks — NEVER switch_agent for subtasks, use task() instead",
    "Tasks you can handle directly — council is expensive and slow",
  ],
}
