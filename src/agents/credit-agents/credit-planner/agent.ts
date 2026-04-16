import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../../types"
import { isGptModel } from "../../types"
import type { AgentOverrideConfig } from "../../../config/schema"
import { createAgentToolRestrictions, type PermissionValue } from "../../../shared/permission-compat"
import { buildDefaultCreditPlannerPrompt } from "./default"
import { buildKimiCreditPlannerPrompt } from "./kimi"

const MODE: AgentMode = "primary"

const BLOCKED_TOOLS = ["edit", "apply_patch", "task", "bash"]

export const CREDIT_PLANNER_DEFAULTS = {
  model: "kimi-k2.5",
  temperature: 0.1,
} as const

export type CreditPlannerPromptSource = "default" | "kimi"

export function getCreditPlannerPromptSource(model?: string): CreditPlannerPromptSource {
  if (!model) return "default"
  
  const modelLower = model.toLowerCase()
  
  if (modelLower.includes("kimi") || modelLower.includes("k2.5") || modelLower.includes("k25")) {
    return "kimi"
  }
  
  return "default"
}

export function buildCreditPlannerPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getCreditPlannerPromptSource(model)

  switch (source) {
    case "kimi":
      return buildKimiCreditPlannerPrompt(useTaskSystem, promptAppend)
    case "default":
    default:
      return buildDefaultCreditPlannerPrompt(useTaskSystem, promptAppend)
  }
}

export const CREDIT_PLANNER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "CreditPlanner",
  triggers: [
    {
      domain: "Feature planning",
      trigger: "Generate structured Change Plan from feature request",
    },
    {
      domain: "Implementation planning",
      trigger: "Analyze codebase and plan file/API/DB changes",
    },
  ],
  useWhen: [
    "Need to plan a new feature implementation",
    "Want structured analysis before coding",
    "Need to identify all files and changes required",
    "Want risk assessment and validation steps",
  ],
  avoidWhen: [
    "Ready to implement without planning",
    "Simple single-file changes",
    "Emergency fixes requiring immediate action",
  ],
  keyTrigger: "Feature request received → invoke CreditPlanner for Change Plan",
}

export function createCreditPlannerAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? CREDIT_PLANNER_DEFAULTS.model
  const temperature = override?.temperature ?? CREDIT_PLANNER_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildCreditPlannerPrompt(model, useTaskSystem, promptAppend)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description:
      override?.description ??
      "Feature implementation planner for Agentic Loop. Analyzes requests, explores codebase, generates structured Change Plans with files, APIs, DB changes, and test flows. (CreditPlanner - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: override?.color ?? "#9B59B6",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  base.fallback_models = override?.fallback_models ?? [
    "kimi-k2.5",
    "claude-opus-4-6",
    "gpt-5.4",
  ]

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 16000 },
  } as AgentConfig
}

createCreditPlannerAgentWithOverrides.mode = MODE
