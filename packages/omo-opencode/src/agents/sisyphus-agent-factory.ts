import type { AgentConfig } from "@opencode-ai/sdk";
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-types";
import { buildClaudeSisyphusAgentConfig, buildGlmSisyphusAgentConfig, buildGptSisyphusAgentConfig, buildGrokSisyphusAgentConfig } from "./sisyphus-agent-config";
import { buildNativeAgentPrompt, getNativePromptSource } from "./native-model-prompt";
import { withRefusalRule } from "./refusal-rule";
import { buildDefaultSisyphusPrompt, categorizeTools } from "./sisyphus/default";
import { isGlmModel, isGptModel, isKimiK2CodeModel, isKimiK2Model, isKimiK3Model, isGrok45Model, isGrok46Model, type AgentMode } from "./types";

const MODE: AgentMode = "primary";

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const role = buildDefaultSisyphusPrompt(model, availableAgents ?? [], categorizeTools(availableToolNames ?? []),
    availableSkills, availableCategories, useTaskSystem);
  const prompt = buildNativeAgentPrompt(model, withRefusalRule(role), availableToolNames, undefined, useTaskSystem);
  if (isGlmModel(model)) return buildGlmSisyphusAgentConfig(MODE, model, prompt);
  if (isGrok45Model(model) || isGrok46Model(model) || getNativePromptSource(model) === "grok-4-7") return buildGrokSisyphusAgentConfig(MODE, model, prompt);
  if (isGptModel(model) || isKimiK2CodeModel(model) || isKimiK2Model(model) || isKimiK3Model(model)) return buildGptSisyphusAgentConfig(MODE, model, prompt);
  return buildClaudeSisyphusAgentConfig(MODE, model, prompt);
}
createSisyphusAgent.mode = MODE;
