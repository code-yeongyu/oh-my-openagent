import { buildNativeAgentPrompt } from "./native-model-prompt"
import { buildOpenCodeRoleAppend } from "./opencode-role-append"
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "./types";
import { buildClaudeThinkingConfig, isGpt5_5Model, isGpt5_6Model, isGpt6Model, isGptModel } from "./types";
import { createAgentToolRestrictions } from "../shared/permission-compat";

const MODE: AgentMode = "subagent";

export const ORACLE_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Oracle",
  triggers: [
    {
      domain: "Architecture decisions",
      trigger: "Multi-system tradeoffs, unfamiliar patterns",
    },
    {
      domain: "Self-review",
      trigger: "After completing significant implementation",
    },
    { domain: "Hard debugging", trigger: "After 2+ failed fix attempts" },
  ],
  useWhen: [
    "Complex architecture design",
    "After completing significant work",
    "2+ failed fix attempts",
    "Unfamiliar code patterns",
    "Security/performance concerns",
    "Multi-system tradeoffs",
  ],
  avoidWhen: [
    "Simple file operations (use direct tools)",
    "First attempt at any fix (try yourself first)",
    "Questions answerable from code you've read",
    "Trivial decisions (variable names, formatting)",
    "Things you can infer from existing code patterns",
  ],
};

/**
 * Default Oracle prompt - used for Claude and other non-GPT models.
 * XML-tagged structure with extended thinking support.
 */
export function createOracleAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
    "task",
  ]);

  const base = {
    description:
      "Read-only consultation agent. High-IQ reasoning specialist for debugging hard problems and high-difficulty architecture design. (Oracle - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: buildNativeAgentPrompt(model, buildOpenCodeRoleAppend("oracle")),
  } as AgentConfig;

  if (isGpt5_6Model(model) || isGpt6Model(model)) {
    return {
      ...base,
      reasoningEffort: "xhigh",
      textVerbosity: "high",
    } as AgentConfig;
  }

  if (isGpt5_5Model(model)) {
    return {
      ...base,
      reasoningEffort: "medium",
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
createOracleAgent.mode = MODE;
