import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import { isGpt5_5Model, isGpt5_6Model } from "../types";
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { categorizeTools, buildAgentIdentitySection } from "../dynamic-agent-prompt-builder";
import { getFrontierToolSchemaPermission } from "../frontier-tool-schema-guard";

import { buildHephaestusPrompt as buildGptPrompt } from "./gpt";
import { buildHephaestusPrompt as buildGpt54Prompt } from "./gpt-5-4";
import { buildGpt55HephaestusPrompt as buildGpt55Prompt } from "./gpt-5-5";
import { buildGpt56HephaestusPrompt as buildGpt56Prompt } from "./gpt-5-6";

const MODE: AgentMode = "primary";
const GPT_5_3_CODEX_RE = /^gpt-5[.-]3-codex(?:$|[.-])/i;
const GPT_5_4_RE = /^gpt-5[.-]4(?:$|[.-])/i;
const GPT_5_5_RE = /^gpt-5[.-]5(?:$|[.-])/i;
const GPT_5_6_RE = /^gpt-5[.-]6(?:$|[.-])/i;

export type HephaestusPromptSource = "gpt-5-6" | "gpt-5-5" | "gpt-5-4" | "gpt";

export class UnsupportedHephaestusModelError extends Error {
  readonly model: string | undefined;

  constructor(model: string | undefined) {
    super(
      `Hephaestus only supports GPT-5.3 Codex, GPT-5.4, GPT-5.5, and GPT-5.6 models; received ${model ?? "no model"}.`,
    );
    this.name = "UnsupportedHephaestusModelError";
    this.model = model;
  }
}

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model;
}

export function isHephaestusSupportedModel(model: string | undefined): boolean {
  if (!model) return false;
  const modelName = extractModelName(model);
  return (
    GPT_5_3_CODEX_RE.test(modelName) ||
    GPT_5_4_RE.test(modelName) ||
    GPT_5_5_RE.test(modelName) ||
    GPT_5_6_RE.test(modelName)
  );
}

function assertHephaestusSupportedModel(model: string | undefined): void {
  if (!isHephaestusSupportedModel(model)) {
    throw new UnsupportedHephaestusModelError(model);
  }
}

export function getHephaestusPromptSource(
  model?: string,
): HephaestusPromptSource {
  assertHephaestusSupportedModel(model);
  if (model && isGpt5_6Model(model)) {
    return "gpt-5-6";
  }
  if (model && isGpt5_5Model(model)) {
    return "gpt-5-5";
  }
  if (model && GPT_5_4_RE.test(extractModelName(model))) {
    return "gpt-5-4";
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
    case "gpt-5-6":
      basePrompt = buildGpt56Prompt(
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      break;
    case "gpt-5-5":
      basePrompt = buildGpt55Prompt(
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      break;
    case "gpt-5-4":
      basePrompt = buildGpt54Prompt(
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
      "Autonomous Deep Worker - goal-oriented execution with GPT Codex. Explores thoroughly with direct tools, completes tasks end-to-end. Inspired by AmpCode deep mode. (Hephaestus - OhMyOpenCode)",
    mode: MODE,
    model,
    maxTokens: 32000,
    prompt,
    color: "#D97706",
    permission: {
      question: "allow",
      task: "deny",
      call_omo_agent: "deny",
      look_at: "deny",
      ...getFrontierToolSchemaPermission(model),
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
