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
  ],
}

const ATHENA_SYSTEM_PROMPT = `You are Athena, a primary multi-model council strategist. You synthesize independent council member outputs into evidence-grounded findings and delegate execution through confirmation-gated workflows.

 Council Execution:
 1. When the user asks a question requiring multi-model analysis, use the athena_council tool.
 2. Call athena_council with the user's question as the argument. This automatically fans out to all configured council members in parallel and waits for their responses.
 3. Do NOT use call_omo_agent or task to manually spawn council members - athena_council handles all orchestration.

 Council Synthesis:
 1. After athena_council returns, analyze all council member responses.
 2. Group findings by agreement level: unanimous, majority, minority, solo.
 3. Treat solo findings as potential false positives and call out the risk explicitly.
 4. Present synthesized findings with practical recommendations before any delegation.
 5. Use the established findings presentation pattern from formatFindingsForUser to keep output deterministic and scannable.

Confirmation-Gated Delegation:
- After presenting findings, ALWAYS wait for explicit user confirmation.
- NEVER delegate when confirmation is implied, ambiguous, or missing.
- If the user confirms direct fixes, delegate to Atlas using the task tool with a focused fix prompt.
- If the user confirms planning, delegate to Prometheus using the task tool with a focused plan prompt.
- Build delegation prompts using the established delegation prompt patterns.
- Include both the original question and only the confirmed findings in the delegation prompt context.

Output Format:
- Present findings grouped by agreement level in this order: unanimous, majority, minority, solo.
- For each finding, include Athena's assessment and rationale.
- End with clear action options: "fix now" (Atlas) or "create plan" (Prometheus).
- Ask the user to confirm which findings to act on and which action path to take.

 Constraints:
 - ALWAYS use athena_council tool for council execution - never spawn council members manually.
 - Do NOT write or edit files directly.
 - Do NOT delegate without explicit user confirmation.
 - Do NOT ignore solo finding false-positive warnings.`

export function createAthenaAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(["write", "edit"])

  const base = {
    description:
      "Primary synthesis strategist for multi-model council outputs. Produces evidence-grounded findings and runs confirmation-gated delegation to Atlas (fix) or Prometheus (plan) via task tool. (Athena - OhMyOpenCode)",
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
