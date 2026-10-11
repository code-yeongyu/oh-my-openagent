import { buildNativeAgentPrompt } from "./native-model-prompt"
import { buildOpenCodeRoleAppend } from "./opencode-role-append"
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
import { buildClaudeThinkingConfig, isGpt5_6Model, isGpt6Model, isGptModel } from "./types";
import { createAgentToolRestrictions } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

/**
 * Momus - Plan Reviewer Agent
 *
 * Named after Momus, the Greek god of satire and mockery, who was known for
 * finding fault in everything - even the works of the gods themselves.
 * He criticized Aphrodite (found her sandals squeaky), Hephaestus (said man
 * should have windows in his chest to see thoughts), and Athena (her house
 * should be on wheels to move from bad neighbors).
 *
 * This agent reviews work plans with the same ruthless critical eye,
 * catching every gap, ambiguity, and missing context that would block
 * implementation.
 */

/**
 * Default Momus prompt - used for Claude and other non-GPT models.
 */
export function createMomusAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
  ]);

  const base = {
    description:
      "Expert reviewer for evaluating work plans against rigorous clarity, verifiability, and completeness standards. (Momus - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: buildNativeAgentPrompt(model, buildOpenCodeRoleAppend("momus")),
  } as AgentConfig;

  if (isGpt5_6Model(model) || isGpt6Model(model)) {
    return {
      ...base,
      reasoningEffort: "high",
      textVerbosity: "high",
    } as AgentConfig;
  }

  if (isGptModel(model)) {
    return {
      ...base,
      reasoningEffort: "medium",
      textVerbosity: "high",
    } as AgentConfig;
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig;
}
createMomusAgent.mode = MODE;

export const momusPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Momus",
  triggers: [
    {
      domain: "Plan review",
      trigger:
        "Evaluate work plans for clarity, verifiability, and completeness",
    },
    {
      domain: "Quality assurance",
      trigger:
        "Catch gaps, ambiguities, and missing context before implementation",
    },
  ],
  useWhen: [
    "After Prometheus creates a work plan",
    "Before executing a complex todo list",
    "To validate plan quality before delegating to executors",
    "When plan needs rigorous review for ADHD-driven omissions",
  ],
  avoidWhen: [
    "Simple, single-task requests",
    "When user explicitly wants to skip review",
    "For trivial plans that don't need formal review",
  ],
  keyTrigger:
    "Work plan saved to `.omo/plans/*.md` → invoke Momus with the file path as the sole prompt (e.g. `prompt=\".omo/plans/my-plan.md\"`). Do NOT invoke Momus for inline plans or todo lists.",
};
