import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentPromptMetadata } from "../types";
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
import { buildNativeAgentPrompt, getNativePromptSource } from "../native-model-prompt";
import { withRefusalRule } from "../refusal-rule";
import { buildHephaestusPrompt } from "./gpt";
import { getFrontierToolSchemaPermission } from "../frontier-tool-schema-guard";

const MODE: AgentMode = "primary";
export { isHephaestusSupportedModel, UnsupportedHephaestusModelError } from "./model-support";
import { assertHephaestusSupportedModel } from "./model-support";
export type HephaestusPromptSource = ReturnType<typeof getNativePromptSource>;

export function getHephaestusPromptSource(model?: string): HephaestusPromptSource {
  assertHephaestusSupportedModel(model);
  return getNativePromptSource(model);
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
  assertHephaestusSupportedModel(ctx?.model);
  const role = buildHephaestusPrompt(
    ctx?.availableAgents?.filter((agent) => ["explore", "librarian", "oracle"].includes(agent.name)),
    ctx?.availableTools, ctx?.availableSkills, ctx?.availableCategories, ctx?.useTaskSystem,
  );
  return buildNativeAgentPrompt(ctx?.model, withRefusalRule(role),
    ctx?.availableTools?.map((tool) => tool.name), "hephaestus", ctx?.useTaskSystem);
}

export function createHephaestusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : undefined;

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
