import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder"
import { buildNativeAgentPrompt, getNativePromptSource } from "../native-model-prompt"
import { buildOpenCodeRoleAppend } from "../opencode-role-append"
import type { CategoryConfig } from "../../config/schema"
import { mergeCategories } from "../../shared/merge-categories"
import { getCategoryDescription } from "./prompt-section-builder"

const MODE: AgentMode = "primary"
export const getAtlasPromptSource = getNativePromptSource
export type AtlasPromptSource = ReturnType<typeof getNativePromptSource>

export interface OrchestratorContext {
  model?: string
  availableAgents?: AvailableAgent[]
  availableSkills?: AvailableSkill[]
  userCategories?: Record<string, CategoryConfig>
}

function buildDynamicOrchestratorPrompt(ctx: OrchestratorContext): string {
  const categories: AvailableCategory[] = Object.keys(mergeCategories(ctx.userCategories)).map((name) => ({
    name, description: getCategoryDescription(name, ctx.userCategories),
  }))
  return buildNativeAgentPrompt(ctx.model, buildOpenCodeRoleAppend("atlas", {
    agents: ctx.availableAgents, skills: ctx.availableSkills, categories,
  }))
}

export function createAtlasAgent(ctx: OrchestratorContext): AgentConfig {
  const baseConfig: AgentConfig = {
    description:
      "Orchestrates work via task() to complete ALL tasks in a todo list until fully done. (Atlas - OhMyOpenCode)",
    mode: MODE,
    ...(ctx.model ? { model: ctx.model } : {}),
    temperature: 0.1,
    prompt: buildDynamicOrchestratorPrompt(ctx),
    color: "#10B981",
  }

  return baseConfig
}
createAtlasAgent.mode = MODE

export const atlasPromptMetadata: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Atlas",
  triggers: [
    {
      domain: "Todo list orchestration",
      trigger: "Complete ALL tasks in a todo list with verification",
    },
    {
      domain: "Multi-agent coordination",
      trigger: "Parallel task execution across specialized agents",
    },
  ],
  useWhen: [
    "User provides a todo list path (.omo/plans/{name}.md)",
    "Multiple tasks need to be completed in sequence or parallel",
    "Work requires coordination across multiple specialized agents",
  ],
  avoidWhen: [
    "Single simple task that doesn't require orchestration",
    "Tasks that can be handled directly by one agent",
    "When user wants to execute tasks manually",
  ],
  keyTrigger:
    "Todo list path provided OR multiple tasks requiring multi-agent orchestration",
}
