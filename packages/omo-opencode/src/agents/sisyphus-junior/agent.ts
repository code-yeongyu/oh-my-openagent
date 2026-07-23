/**
 * Sisyphus-Junior - Focused Task Executor
 *
 * Executes delegated tasks directly without spawning other agents.
 * Category-spawned executor with domain-specific configurations.
 *
 * Routing:
 * 1. Kimi K3 -> kimi-k3.ts (K3-native executor; reasoning depth with built-in stop conditions)
 * 2. Kimi K2.7 -> kimi-k2-7.ts (restrained, outcome-first)
 * 3. Kimi K2.x -> kimi-k2-6.ts
 * 4. GPT models (openai/*, github-copilot/gpt-*) -> gpt-5-5.ts / gpt-5-4.ts / gpt.ts
 * 5. Gemini models (google/*, google-vertex/*) -> gemini.ts (Gemini-optimized)
 * 6. GLM models -> glm-5-2.ts
 * 7. Default (Claude, etc.) -> default.ts (Claude-optimized)
 */

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { isGlmModel, isGpt5_5Model, isGpt5_6Model, isGptModel, isGeminiModel, isKimiK2Model, isKimiK27Model, isKimiK3Model, buildClaudeThinkingConfig } from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import {
  createAgentToolRestrictions,
  migrateAgentConfig,
  type PermissionValue,
} from "../../shared/permission-compat"

import { buildDefaultSisyphusJuniorPrompt } from "./default"
import { buildKimiK26SisyphusJuniorPrompt } from "./kimi-k2-6"
import { buildKimiK27SisyphusJuniorPrompt } from "./kimi-k2-7"
import { buildKimiK3SisyphusJuniorPrompt } from "./kimi-k3"
import { buildGptSisyphusJuniorPrompt } from "./gpt"
import { buildGpt54SisyphusJuniorPrompt } from "./gpt-5-4"
import { buildGpt55SisyphusJuniorPrompt } from "./gpt-5-5"
import { buildGeminiSisyphusJuniorPrompt } from "./gemini"
import { buildGlm52SisyphusJuniorPrompt } from "./glm-5-2"

const MODE: AgentMode = "subagent"

// Core tools that Sisyphus-Junior must NEVER have access to.
const BLOCKED_TOOLS = ["task", "call_omo_agent", "look_at"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-6",
  temperature: 0.1,
} as const

export type SisyphusJuniorPromptSource =
  | "default"
  | "kimi-k2"
  | "kimi-k2-7"
  | "kimi-k3"
  | "gpt"
  | "gpt-5-5"
  | "gpt-5-4"
  | "gemini"
  | "glm-5-2"

export function getSisyphusJuniorPromptSource(model?: string): SisyphusJuniorPromptSource {
  if (model && isKimiK3Model(model)) return "kimi-k3"
  if (model && isKimiK27Model(model)) return "kimi-k2-7"
  if (model && isKimiK2Model(model)) return "kimi-k2"
  if (model && isGptModel(model)) {
    if (isGpt5_5Model(model) || isGpt5_6Model(model)) return "gpt-5-5"
    const lower = model.toLowerCase()
    if (lower.includes("gpt-5.4") || lower.includes("gpt-5-4")) return "gpt-5-4"
    return "gpt"
  }
  if (model && isGeminiModel(model)) {
    return "gemini"
  }
  if (model && isGlmModel(model)) return "glm-5-2"
  return "default"
}

/**
 * Builds the appropriate Sisyphus-Junior prompt based on model.
 */
export function buildSisyphusJuniorPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getSisyphusJuniorPromptSource(model)

  switch (source) {
    case "kimi-k3":
      return buildKimiK3SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "kimi-k2-7":
      return buildKimiK27SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "kimi-k2":
      return buildKimiK26SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt-5-5":
      return buildGpt55SisyphusJuniorPrompt(useTaskSystem, promptAppend, model)
    case "gpt-5-4":
      return buildGpt54SisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gpt":
      return buildGptSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "gemini":
      return buildGeminiSisyphusJuniorPrompt(useTaskSystem, promptAppend)
    case "glm-5-2":
      return buildGlm52SisyphusJuniorPrompt(useTaskSystem, promptAppend)
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
  const blockedTools = BLOCKED_TOOLS

  const baseRestrictions = createAgentToolRestrictions(blockedTools)

  const migratedOverride = override
    ? (migrateAgentConfig(override as Record<string, unknown>) as typeof override)
    : undefined
  const userPermission = (migratedOverride?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of blockedTools) {
    merged[tool] = "deny"
  }
  const toolsConfig = { permission: { ...merged, ...basePermission } as Record<string, PermissionValue> }
  const permission: Record<string, PermissionValue> = {
    ...toolsConfig.permission,
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

  if (isGlmModel(model)) {
    return base as AgentConfig
  }

  return {
    ...base,
    ...buildClaudeThinkingConfig(model),
  } as AgentConfig
}

createSisyphusJuniorAgentWithOverrides.mode = MODE
