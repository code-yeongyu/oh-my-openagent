import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
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
