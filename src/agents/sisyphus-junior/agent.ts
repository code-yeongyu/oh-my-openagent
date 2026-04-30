import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import {
  isGlmSisyphusHarnessModel,
  isGpt5_5Model,
  isGptModel,
  isGeminiModel,
  isKimiK2Model,
} from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../shared/permission-compat"
import { getGptApplyPatchPermission } from "../gpt-apply-patch-guard"

import { buildDefaultSisyphusJuniorPrompt } from "./default"
import { buildGlmSisyphusJuniorPrompt } from "./glm"
import { buildKimiK26SisyphusJuniorPrompt } from "./kimi-k2-6"
import { buildGptSisyphusJuniorPrompt } from "./gpt"
import { buildGpt54SisyphusJuniorPrompt } from "./gpt-5-4"
import { buildGpt55SisyphusJuniorPrompt } from "./gpt-5-5"
import { buildGpt53CodexSisyphusJuniorPrompt } from "./gpt-5-3-codex"
import { buildGeminiSisyphusJuniorPrompt } from "./gemini"

const MODE: AgentMode = "subagent"

const BLOCKED_TOOLS = ["task"]
const GPT_BLOCKED_TOOLS = ["task", "apply_patch"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-6",
  temperature: 0.1,
} as const

export type SisyphusJuniorPromptSource =
  | "default"
  | "kimi-k2"
  | "glm"
  | "gpt"
  | "gpt-5-5"
  | "gpt-5-4"
  | "gpt-5-3-codex"
  | "gemini"

export function getSisyphusJuniorPromptSource(model?: string): SisyphusJuniorPromptSource {
  if (model && isKimiK2Model(model)) return "kimi-k2"
  if (model && isGlmSisyphusHarnessModel(model)) return "glm"
  if (model && isGptModel(model)) {
    if (isGpt5_5Model(model)) return "gpt-5-5"
    const lower = model.toLowerCase()
    if (lower.includes("gpt-5.4") || lower.includes("gpt-5-4")) return "gpt-5-4"
    if (lower.includes("gpt-5.3-codex") || lower.includes("gpt-5-3-codex")) return "gpt-5-3-codex"
    return "gpt"
  }
  if (model && isGeminiModel(model)) {
    return "gemini"
  }
  return "default"
}

export function buildSisyphusJuniorPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getSisyphusJuniorPromptSource(model)

  switch (source) {
    case "kimi-k2":
      return buildKimiK26SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "glm":
      return buildGlmSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt-5-5":
      return buildGpt55SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt-5-4":
      return buildGpt54SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt-5-3-codex":
      return buildGpt53CodexSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt":
      return buildGptSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gemini":
      return buildGeminiSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "default":
    default:
      return buildDefaultSisyphusJuniorPrompt(useTaskSystem, promptAppend)
  }
}

export function createSisyphusJuniorAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? systemDefaultModel ?? SISYPHUS_JUNIOR_DEFAULTS.model
  const temperature = override?.temperature ?? SISYPHUS_JUNIOR_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildSisyphusJuniorPrompt(model, useTaskSystem, promptAppend)
  const blockedTools = isGptModel(model) ? GPT_BLOCKED_TOOLS : BLOCKED_TOOLS

  const baseRestrictions = createAgentToolRestrictions(blockedTools)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of blockedTools) {
    merged[tool] = "deny"
  }
  merged.call_omo_agent = "allow"
  const toolsConfig = { permission: { ...merged, ...basePermission } as Record<string, PermissionValue> }
  const permission: Record<string, PermissionValue> = {
    ...toolsConfig.permission,
    ...getGptApplyPatchPermission(model),
  }

  const base: AgentConfig = {
    description: override?.description ??
      "Focused task executor. Same discipline, no delegation. (Sisyphus-Junior - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    permission,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  if (isGlmSisyphusHarnessModel(model)) {
    return { ...base, thinking: { type: "enabled" } } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}

createSisyphusJuniorAgentWithOverrides.mode = MODE
