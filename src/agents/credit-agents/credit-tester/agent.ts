import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../../types"
import { isGptModel } from "../../types"
import type { AgentOverrideConfig } from "../../../config/schema"
import { createAgentToolRestrictions, type PermissionValue } from "../../../shared/permission-compat"
import { buildDefaultCreditTesterPrompt } from "./default"

const MODE: AgentMode = "primary"

const BLOCKED_TOOLS = ["edit", "apply_patch"]

export const CREDIT_TESTER_DEFAULTS = {
  model: "minimaxai/minimax-m2",
  temperature: 0.1,
} as const

export type CreditTesterPromptSource = "default"

export function getCreditTesterPromptSource(_model?: string): CreditTesterPromptSource {
  return "default"
}

export function buildCreditTesterPrompt(
  _model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  return buildDefaultCreditTesterPrompt(useTaskSystem, promptAppend)
}

export const CREDIT_TESTER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "CreditTester",
  triggers: [
    {
      domain: "Test execution",
      trigger: "Execute test flows and validation steps from Change Plan",
    },
    {
      domain: "Implementation validation",
      trigger: "Verify implementation matches specification",
    },
  ],
  useWhen: [
    "Implementation is complete and needs validation",
    "Need to execute test flows defined in Change Plan",
    "Must verify all acceptance criteria are met",
  ],
  avoidWhen: [
    "No test plan exists",
    "Implementation is not complete",
    "Need to fix issues (report only, don't fix)",
  ],
  keyTrigger: "Implementation complete → invoke CreditTester for validation",
}

export function createCreditTesterAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? CREDIT_TESTER_DEFAULTS.model
  const temperature = override?.temperature ?? CREDIT_TESTER_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildCreditTesterPrompt(model, useTaskSystem, promptAppend)

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
      "Feature validation tester for Agentic Loop. Executes test flows, verifies implementation against Change Plan, reports failures. (CreditTester - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: override?.color ?? "#E74C3C",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  base.fallback_models = override?.fallback_models ?? [
    "minimax-m2",
    "claude-sonnet-4-6",
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

createCreditTesterAgentWithOverrides.mode = MODE
