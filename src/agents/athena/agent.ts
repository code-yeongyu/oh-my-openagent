import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { ATHENA_INTERACTIVE_PROMPT } from "./interactive-prompt"
import { ATHENA_NON_INTERACTIVE_PROMPT } from "./non-interactive-prompt"

const MODE: AgentMode = "all"

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
    {
      domain: "Non-interactive council",
      trigger: "Agent needs multi-model analysis without user interaction",
    },
  ],
  useWhen: [
    "You need Athena to synthesize multi-model council outputs into concrete findings",
    "You need agreement-level confidence before selecting what to execute next",
    "You need explicit user confirmation before delegating fixes to Atlas or planning to Prometheus",
    "CLI invocation via oh-my-opencode run needing structured council output",
    "Agent-to-agent invocation where structured <athena_council_result> JSON is required",
  ],
  avoidWhen: [
    "Single-model questions that do not need council synthesis",
    "Tasks requiring direct implementation by Athena",
  ],
}

// Selects the appropriate prompt based on invocation context.
// CLI mode (OPENCODE_CLI_RUN_MODE=true) uses the non-interactive prompt which auto-selects
// members and returns structured <athena_council_result> JSON.
// NOTE: When Athena is invoked via call_omo_agent in interactive mode, the interactive prompt
// is used but tool-config-handler.ts denies the Question tool, and the non-interactive
// constraints are enforced via tool permissions. This is a known limitation — the factory
// is called once at plugin init, not per-session.
function selectPrompt(): string {
  if (process.env.OPENCODE_CLI_RUN_MODE === "true") {
    return ATHENA_NON_INTERACTIVE_PROMPT
  }
  return ATHENA_INTERACTIVE_PROMPT
}

export function createAthenaAgent(model: string): AgentConfig {
  // NOTE: Athena/council tool restrictions are also defined in:
  // - src/shared/agent-tool-restrictions.ts (boolean format for session.prompt)
  // - src/plugin-handlers/tool-config-handler.ts (allow/deny string format)
  // Keep all three in sync when modifying.
  const restrictions = createAgentToolRestrictions(["call_omo_agent"])

  // question permission is set by tool-config-handler.ts based on CLI mode (allow/deny)

  const base = {
    description:
      "Primary synthesis strategist for multi-model council outputs. Produces evidence-grounded findings and runs confirmation-gated delegation via switch_agent (Prometheus planning, Atlas fixes, or direct implementation agents where runtime guidance requires). (Athena - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    permission: restrictions.permission,
    prompt: selectPrompt(),
    color: "#1F8EFA",
  }

  return base
}
createAthenaAgent.mode = MODE
