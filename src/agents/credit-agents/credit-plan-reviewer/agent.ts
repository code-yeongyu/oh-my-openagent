import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../../types"
import { isGptModel } from "../../types"
import type { AgentOverrideConfig } from "../../../config/schema"
import { createAgentToolRestrictions, type PermissionValue } from "../../../shared/permission-compat"
import { buildDefaultCreditPlanReviewerPrompt } from "./default"

const MODE: AgentMode = "primary"

const BLOCKED_TOOLS = ["edit", "apply_patch", "bash", "task"]

export const CREDIT_PLAN_REVIEWER_DEFAULTS = {
  model: "kimi-k2.5",
  temperature: 0.1,
} as const

export type CreditPlanReviewerPromptSource = "default"

export function getCreditPlanReviewerPromptSource(_model?: string): CreditPlanReviewerPromptSource {
  return "default"
}

export function buildCreditPlanReviewerPrompt(
  _model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  return buildDefaultCreditPlanReviewerPrompt(useTaskSystem, promptAppend)
}

export const CREDIT_PLAN_REVIEWER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "CreditPlanReviewer",
  triggers: [
    {
      domain: "Plan review",
      trigger: "Validate Change Plan before execution",
    },
    {
      domain: "Quality assurance",
      trigger: "Check plans for architectural compliance and completeness",
    },
  ],
  useWhen: [
    "After credit-planner creates a Change Plan",
    "Before credit-executor implements a plan",
    "When architectural validation is needed",
    "When plan quality assurance is required",
  ],
  avoidWhen: [
    "Plan has already been reviewed and approved",
    "Simple single-file changes",
    "Emergency fixes requiring immediate action",
  ],
  keyTrigger: "Change Plan created → invoke CreditPlanReviewer for validation",
}

export function createCreditPlanReviewerAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? CREDIT_PLAN_REVIEWER_DEFAULTS.model
  const temperature = override?.temperature ?? CREDIT_PLAN_REVIEWER_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildCreditPlanReviewerPrompt(model, useTaskSystem, promptAppend)

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
      "Rigorous plan reviewer for Euler LSP. Validates Change Plans for architectural correctness, completeness, and risk assessment. Provides APPROVE/REJECT/CONDITIONAL verdicts. (CreditPlanReviewer - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: override?.color ?? "#E67E22",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  base.fallback_models = override?.fallback_models ?? [
    "kimi-k2.5",
    "gpt-5.4",
    "claude-opus-4-6",
  ]

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "high" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 16000 },
  } as AgentConfig
}

createCreditPlanReviewerAgentWithOverrides.mode = MODE
