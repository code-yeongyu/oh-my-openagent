import type { AgentConfig } from "@opencode-ai/sdk";
import { categorizeTools } from "./dynamic-agent-prompt-builder";
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-builder";
import {
  buildClaudeSisyphusAgentConfig,
  buildGptSisyphusAgentConfig,
} from "./sisyphus-agent-config";
import { buildFallbackSisyphusPrompt } from "./sisyphus-dynamic-prompt";
import { buildClaudeOpus47SisyphusPrompt } from "./sisyphus/claude-opus-4-7";
import { buildGpt54SisyphusPrompt } from "./sisyphus/gpt-5-4";
import { buildGpt55SisyphusPrompt } from "./sisyphus/gpt-5-5";
import { buildKimiK26SisyphusPrompt } from "./sisyphus/kimi-k2-6";
import type { AgentMode } from "./types";
import {
  isClaudeOpus47Model,
  isGpt5_5Model,
  isGptModel,
  isGptNativeSisyphusModel,
  isKimiK2Model,
} from "./types";

const MODE: AgentMode = "primary";

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];
  const skills = availableSkills ?? [];
  const categories = availableCategories ?? [];
  const agents = availableAgents ?? [];

  if (isKimiK2Model(model)) {
    return buildGptSisyphusAgentConfig(
      MODE,
      model,
      buildKimiK26SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
    );
  }

  if (isGpt5_5Model(model)) {
    return buildGptSisyphusAgentConfig(
      MODE,
      model,
      buildGpt55SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
    );
  }

  if (isGptNativeSisyphusModel(model)) {
    return buildGptSisyphusAgentConfig(
      MODE,
      model,
      buildGpt54SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
    );
  }

  if (isClaudeOpus47Model(model)) {
    return buildClaudeSisyphusAgentConfig(
      MODE,
      model,
      buildClaudeOpus47SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
    );
  }

  const prompt = buildFallbackSisyphusPrompt(
    model,
    agents,
    tools,
    skills,
    categories,
    useTaskSystem,
  );

  if (isGptModel(model)) {
    return buildGptSisyphusAgentConfig(MODE, model, prompt);
  }

  return buildClaudeSisyphusAgentConfig(MODE, model, prompt);
}
createSisyphusAgent.mode = MODE;
