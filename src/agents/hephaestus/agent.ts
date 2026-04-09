import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import { isGptModel, isGpt5_4Model, isGpt5_3CodexModel } from "../types";
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { categorizeTools, buildAgentIdentitySection } from "../dynamic-agent-prompt-builder";

import { buildHephaestusPrompt as buildGptPrompt } from "./gpt";
import { buildHephaestusPrompt as buildGpt53CodexPrompt } from "./gpt-5-3-codex";
import { buildHephaestusPrompt as buildGpt54Prompt } from "./gpt-5-4";

const MODE: AgentMode = "primary";

export type HephaestusPromptSource = "gpt-5-4" | "gpt-5-3-codex" | "gpt";

export function getHephaestusPromptSource(
  model?: string,
): HephaestusPromptSource {
  if (model && isGpt5_4Model(model)) {
    return "gpt-5-4";
  }
  if (model && isGpt5_3CodexModel(model)) {
    return "gpt-5-3-codex";
  }
  return "gpt";
}

export interface HephaestusContext {
  model?: string;
  availableAgents?: AvailableAgent[];
  availableTools?: AvailableTool[];
  availableSkills?: AvailableSkill[];
  availableCategories?: AvailableCategory[];
  useTaskSystem?: boolean;
}

export function getHephaestusPrompt(
  model?: string,
  useTaskSystem = false,
): string {
  return buildDynamicHephaestusPrompt({ model, useTaskSystem });
}

function buildDynamicHephaestusPrompt(ctx?: HephaestusContext): string {
  const agents = ctx?.availableAgents ?? [];
  const tools = ctx?.availableTools ?? [];
  const skills = ctx?.availableSkills ?? [];
  const categories = ctx?.availableCategories ?? [];
  const useTaskSystem = ctx?.useTaskSystem ?? false;
  const model = ctx?.model;

  const source = getHephaestusPromptSource(model);

  let basePrompt: string;
  switch (source) {
    case "gpt-5-4":
      basePrompt = buildGpt54Prompt(
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      break;
    case "gpt-5-3-codex":
      basePrompt = buildGpt53CodexPrompt(
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      break;
    case "gpt":
    default:
      basePrompt = buildGptPrompt(
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      break;
  }

  const agentIdentity = buildAgentIdentitySection(
    "Hephaestus",
    "Autonomous deep worker for software engineering from OhMyOpenCode",
  );

  return `${agentIdentity}\n${basePrompt}`;
}

export function createHephaestusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];

  const prompt = buildDynamicHephaestusPrompt({
    model,
    availableAgents,
    availableTools: tools,
    availableSkills,
    availableCategories,
    useTaskSystem,
  });

  return {
    description:
      "Autonomous Deep Worker - goal-oriented execution with GPT Codex. Explores thoroughly before acting, uses explore/librarian agents for comprehensive context, completes tasks end-to-end. Inspired by AmpCode deep mode. (Hephaestus - OhMyOpenCode)",
    mode: MODE,
    model,
    maxTokens: 32000,
    prompt,
    color: "#D97706",
    permission: {
      question: "allow",
      call_omo_agent: "deny",
      ...(isGptModel(model) ? { apply_patch: "deny" as const } : {}),
    } as AgentConfig["permission"],
    reasoningEffort: "medium",
  };
}
createHephaestusAgent.mode = MODE;

export const hephaestusPromptMetadata: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Hephaestus",
  triggers: [
    {
      domain: "Autonomous deep work",
      trigger: "End-to-end task completion without premature stopping",
    },
    {
      domain: "Complex implementation",
      trigger: "Multi-step implementation requiring thorough exploration",
    },
  ],
  useWhen: [
    "Task requires deep exploration before implementation",
    "User wants autonomous end-to-end completion",
    "Complex multi-file changes needed",
  ],
  avoidWhen: [
    "Simple single-step tasks",
    "Tasks requiring user confirmation at each step",
    "When orchestration across multiple agents is needed (use Atlas)",
  ],
  keyTrigger: "Complex implementation task requiring autonomous deep work",
};
