import type { AgentConfig } from "@opencode-ai/sdk";
import { getFrontierToolSchemaPermission } from "./frontier-tool-schema-guard";
import { buildClaudeThinkingConfig } from "./types";
import type { AgentMode } from "./types";

const SISYPHUS_DESCRIPTION =
  "Powerful AI orchestrator. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses explore for internal code (parallel-friendly), librarian for external docs. (Sisyphus - OhMyOpenCode)";

function buildSisyphusPermission(model: string): AgentConfig["permission"] {
  return {
    question: "allow",
    call_omo_agent: "allow",
    ...getFrontierToolSchemaPermission(model),
  } as AgentConfig["permission"];
}

function buildBaseSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    description: SISYPHUS_DESCRIPTION,
    mode,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission: buildSisyphusPermission(model),
  };
}

export function buildGptSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    ...buildBaseSisyphusAgentConfig(mode, model, prompt),
    reasoningEffort: "medium",
  };
}

export function buildGlmSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return buildBaseSisyphusAgentConfig(mode, model, prompt);
}

export function buildClaudeSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    ...buildBaseSisyphusAgentConfig(mode, model, prompt),
    ...buildClaudeThinkingConfig(model),
  };
}
