/**
 * Sisyphus-Junior - Focused Task Executor
 *
 * Executes delegated tasks directly without spawning other agents.
 * Category-spawned executor with domain-specific configurations.
 *
 * Routing:
 * 1. GPT models (openai/*, github-copilot/gpt-*) -> gpt.ts (GPT-5.2 optimized)
 * 2. Default (Claude, etc.) -> default.ts (Claude-optimized)
 */

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { isGptModel } from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../shared/permission-compat"

import { buildDefaultSisyphusJuniorPrompt } from "./default"
import { buildGptSisyphusJuniorPrompt } from "./gpt"

const MODE: AgentMode = "subagent"

// Core tools that Sisyphus-Junior must NEVER have access to
// Note: call_omo_agent is ALLOWED so subagents can spawn explore/librarian
const BLOCKED_TOOLS = ["task"]

export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-5",
  temperature: 0.1,
} as const

export type SisyphusJuniorPromptSource = "default" | "gpt"

/**
 * Determines which Sisyphus-Junior prompt to use based on model.
 */
export function getSisyphusJuniorPromptSource(model?: string): SisyphusJuniorPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
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
    case "gpt":
      return buildGptSisyphusJuniorPrompt(useTaskSystem, promptAppend)
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

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const userPermission = (override?.permission ?? {}) as Record<string, PermissionValue>
  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = { ...userPermission }
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  merged.call_omo_agent = "allow"
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description: override?.description ??
      "Focused task executor. Same discipline, no delegation. (Sisyphus-Junior - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 64000,
    prompt,
    color: override?.color ?? "#20B2AA",
    ...toolsConfig,
  }

  if (override?.top_p !== undefined) {
    base.top_p = override.top_p
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" } as AgentConfig
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 32000 },
  } as AgentConfig
}

createSisyphusJuniorAgentWithOverrides.mode = MODE
