import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../../types"
import { isGptModel } from "../../types"
import type { AgentOverrideConfig } from "../../../config/schema"
import { createAgentToolRestrictions, type PermissionValue } from "../../../shared/permission-compat"
import { buildDefaultCreditExecutorPrompt } from "./default"

const MODE: AgentMode = "primary"

const BLOCKED_TOOLS: string[] = []

export const CREDIT_EXECUTOR_DEFAULTS = {
  model: "zhipu/glm-5",
  temperature: 0.1,
} as const

export type CreditExecutorPromptSource = "default"

export function getCreditExecutorPromptSource(_model?: string): CreditExecutorPromptSource {
  return "default"
}

export function buildCreditExecutorPrompt(
  _model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  return buildDefaultCreditExecutorPrompt(useTaskSystem, promptAppend)
}

export const CREDIT_EXECUTOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "CreditExecutor",
  triggers: [
    {
      domain: "Plan execution",
      trigger: "Execute Change Plan implementation",
    },
    {
      domain: "Code implementation",
      trigger: "Implement features exactly as specified in plan",
    },
  ],
  useWhen: [
    "Change Plan is ready for execution",
    "Need deterministic implementation of planned features",
    "Ready to write code based on specification",
  ],
  avoidWhen: [
    "No plan exists - need planning first",
    "Plan is ambiguous or incomplete",
    "Need to deviate from plan requirements",
  ],
  keyTrigger: "Change Plan approved → invoke CreditExecutor for implementation",
}

export function createCreditExecutorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? CREDIT_EXECUTOR_DEFAULTS.model
  const temperature = override?.temperature ?? CREDIT_EXECUTOR_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildCreditExecutorPrompt(model, useTaskSystem, promptAppend)

  const toolsConfig = BLOCKED_TOOLS.length > 0 
    ? createAgentToolRestrictions(BLOCKED_TOOLS)
    : { permission: {} as Record<string, PermissionValue> }

  const base: AgentConfig = {
    description:
      override?.description ??
      "Change Plan executor for Agentic Loop. Implements features exactly as specified in Change Plans. Deterministic execution, no reinterpretation. (CreditExecutor - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: override?.color ?? "#27AE60",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  base.fallback_models = override?.fallback_models ?? [
    "glm-5",
    "claude-opus-4-6",
    "gpt-5.3-codex",
  ]

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 16000 },
  } as AgentConfig
}

createCreditExecutorAgentWithOverrides.mode = MODE
