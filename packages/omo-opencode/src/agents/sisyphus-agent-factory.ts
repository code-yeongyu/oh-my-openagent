import type { AgentConfig } from "@opencode-ai/sdk";
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-types";
import { buildClaudeSisyphusAgentConfig, buildGlmSisyphusAgentConfig, buildGptSisyphusAgentConfig, buildGrokSisyphusAgentConfig } from "./sisyphus-agent-config";
import { buildNativeAgentPrompt } from "./native-model-prompt";
import { buildOpenCodeRoleAppend } from "./opencode-role-append";
import { isGlmModel, isGptModel, isKimiK2CodeModel, isKimiK2Model, isKimiK3Model, isGrok45Model, isGrok46Model, isGrok47Model, type AgentMode } from "./types";

const MODE: AgentMode = "primary";

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const prompt = buildNativeAgentPrompt(model, buildOpenCodeRoleAppend("sisyphus", {
    agents: availableAgents, skills: availableSkills, categories: availableCategories, useTaskSystem,
  }), availableToolNames);
  if (isGlmModel(model)) return buildGlmSisyphusAgentConfig(MODE, model, prompt);
  if (isGrok45Model(model) || isGrok46Model(model) || isGrok47Model(model)) return buildGrokSisyphusAgentConfig(MODE, model, prompt);
  if (isGptModel(model) || isKimiK2CodeModel(model) || isKimiK2Model(model) || isKimiK3Model(model)) return buildGptSisyphusAgentConfig(MODE, model, prompt);
  return buildClaudeSisyphusAgentConfig(MODE, model, prompt);
}
createSisyphusAgent.mode = MODE;
