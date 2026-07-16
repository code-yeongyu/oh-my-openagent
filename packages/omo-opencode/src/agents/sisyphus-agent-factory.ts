import type { AgentConfig } from "@opencode-ai/sdk";
import { categorizeTools } from "./dynamic-agent-prompt-builder";
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-builder";
import {
  buildClaudeSisyphusAgentConfig,
  buildGlmSisyphusAgentConfig,
  buildGptSisyphusAgentConfig,
  buildGenericSisyphusAgentConfig,
} from "./sisyphus-agent-config";
import { buildFallbackSisyphusPrompt } from "./sisyphus-dynamic-prompt";
import { buildClaudeFable5SisyphusPrompt } from "./sisyphus/claude-fable-5";
import { buildClaudeOpus47SisyphusPrompt } from "./sisyphus/claude-opus-4-7";
import { buildClaudeOpus48SisyphusPrompt } from "./sisyphus/claude-opus-4-8";
import { buildGlm52SisyphusPrompt } from "./sisyphus/glm-5-2";
import { buildGpt54SisyphusPrompt } from "./sisyphus/gpt-5-4";
import { buildGpt55SisyphusPrompt } from "./sisyphus/gpt-5-5";
import { buildKimiK26SisyphusPrompt } from "./sisyphus/kimi-k2-6";
import { buildKimiK27SisyphusPrompt } from "./sisyphus/kimi-k2-7";
import type { AgentMode } from "./types";
import {
  isClaudeFable5Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isClaudeModel,
  isGlmModel,
  isGpt5_5Model,
  isGpt5_6Model,
  isGptModel,
  isGptNativeSisyphusModel,
  isKimiK2Model,
  isKimiK27Model,
} from "./types";

const MODE: AgentMode = "primary";

/**
 * Identifies which prompt body `createSisyphusAgent` bakes for a given model.
 * The whole Sisyphus prompt is model-family-specific and selected here, so this
 * is the single source of truth shared with the runtime reconciler: when the TUI
 * runtime model resolves to a different family than the configured one, the baked
 * body is the wrong family and must be rebuilt (issue #5297/#5316).
 */
export type SisyphusPromptFamily =
  | "kimi-k2-7"
  | "kimi-k2-6"
  | "gpt-5-5"
  | "gpt-5-4"
  | "claude-fable-5"
  | "claude-opus-4-8"
  | "claude-opus-4-7"
  | "glm-5-2"
  | "fallback";

export function resolveSisyphusPromptFamily(model: string): SisyphusPromptFamily {
  if (isKimiK27Model(model)) return "kimi-k2-7";
  if (isKimiK2Model(model)) return "kimi-k2-6";
  if (isGpt5_5Model(model)) return "gpt-5-5";
  if (isGptNativeSisyphusModel(model)) return "gpt-5-4";
  if (isClaudeFable5Model(model)) return "claude-fable-5";
  if (isClaudeOpus48Model(model)) return "claude-opus-4-8";
  if (isClaudeOpus47Model(model)) return "claude-opus-4-7";
  if (isGlmModel(model)) return "glm-5-2";
  return "fallback";
}

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

  switch (resolveSisyphusPromptFamily(model)) {
    case "kimi-k2-7":
      return buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildKimiK27SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "kimi-k2-6":
      return buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildKimiK26SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "gpt-5-5":
      return buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildGpt55SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "gpt-5-4":
      return buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildGpt54SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "claude-fable-5":
      return buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeFable5SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "claude-opus-4-8":
      return buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeOpus48SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "claude-opus-4-7":
      return buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeOpus47SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "glm-5-2":
      return buildGlmSisyphusAgentConfig(
        MODE,
        model,
        buildGlm52SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
    case "fallback": {
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
      } else if (isClaudeModel(model)) {
        return buildClaudeSisyphusAgentConfig(MODE, model, prompt);
      }
      // For all unrecognized models (e.g., local llama.cpp via Gemma4/Qwen),
      // use generic config instead of forcing GPT/Claude-specific behavior.
      return buildGenericSisyphusAgentConfig(MODE, model, prompt);
    }
  }
}

createSisyphusAgent.mode = MODE;
