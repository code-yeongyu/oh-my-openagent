import { buildNativeAgentPrompt } from "./native-model-prompt"
import { buildOpenCodeRoleAppend } from "./opencode-role-append"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { buildClaudeThinkingConfig } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

/**
 * Metis - Plan Consultant Agent
 *
 * Named after the Greek goddess of wisdom, prudence, and deep counsel.
 * Metis analyzes user requests BEFORE planning to prevent AI failures.
 *
 * Core responsibilities:
 * - Identify hidden intentions and unstated requirements
 * - Detect ambiguities that could derail implementation
 * - Flag potential AI-slop patterns (over-engineering, scope creep)
 * - Generate clarifying questions for the user
 * - Prepare directives for the planner agent
 */

const metisRestrictions = createAgentToolRestrictions([
  "write",
  "edit",
  "apply_patch",
])

export function createMetisAgent(model: string): AgentConfig {
  const prompt = buildNativeAgentPrompt(model, buildOpenCodeRoleAppend("metis"))
  return {
    description:
      "Pre-planning consultant that analyzes requests to identify hidden intentions, ambiguities, and AI failure points. (Metis - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.3,
    ...metisRestrictions,
    prompt,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig
}
createMetisAgent.mode = MODE

export const metisPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  triggers: [
    {
      domain: "Pre-planning analysis",
      trigger: "Complex task requiring scope clarification, ambiguous requirements",
    },
  ],
  useWhen: [
    "Before planning non-trivial tasks",
    "When user request is ambiguous or open-ended",
    "To prevent AI over-engineering patterns",
  ],
  avoidWhen: [
    "Simple, well-defined tasks",
    "User has already provided detailed requirements",
  ],
  promptAlias: "Metis",
  keyTrigger: "Ambiguous or complex request → consult Metis before Prometheus",
}
