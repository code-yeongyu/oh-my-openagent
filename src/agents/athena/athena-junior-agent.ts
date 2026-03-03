import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { ATHENA_NON_INTERACTIVE_PROMPT } from "./non-interactive-prompt"

const MODE: AgentMode = "subagent"

export const ATHENA_JUNIOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Athena-Junior",
  triggers: [
    { domain: "Agent needs multi-model analysis", trigger: "Use task(subagent_type=\"athena-junior\") when council synthesis is needed without interactive handoff" },
    { domain: "Programmatic synthesis", trigger: "Need structured council output for automated pipelines, retries, or downstream machine processing" },
  ],
  useWhen: [
    "CLI invocation via oh-my-opencode run needing structured council output",
    "Agent-to-agent invocation where structured <athena_council_result> JSON is required",
    "Automated pipelines needing multi-model consensus",
  ],
  avoidWhen: [
    "Interactive sessions where user can confirm actions (use athena instead)",
    "Single-model questions that do not need council synthesis",
  ],
}

export function createAthenaJuniorAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(["call_omo_agent", "question"])
  return {
    description:
      "Non-interactive council orchestrator for programmatic multi-model synthesis. Returns structured <athena_council_result> JSON without user interaction. (Athena-Junior - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    permission: restrictions.permission,
    prompt: ATHENA_NON_INTERACTIVE_PROMPT,
    color: "#1F8EFA",
  }
}
createAthenaJuniorAgent.mode = MODE
