/**
 * Mouse - Focused Task Executor
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
import { isGptModel, isAnthropicModel } from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../shared/permission-compat"

import { buildDefaultMousePrompt } from "./default"
import { buildGptMousePrompt } from "./gpt"

const MODE: AgentMode = "subagent"

// Core tools that Mouse must NEVER have access to
// Note: call_omo_agent is ALLOWED so subagents can spawn explore/librarian
const BLOCKED_TOOLS = ["task"]

export const MOUSE_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-6",
  temperature: 0.1,
} as const

export type MousePromptSource = "default" | "gpt"

/**
 * Determines which Mouse prompt to use based on model.
 */
export function getMousePromptSource(model?: string): MousePromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  return "default"
}

/**
 * Builds the appropriate Mouse prompt based on model.
 */
export function buildMousePrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getMousePromptSource(model)

  switch (source) {
    case "gpt":
      return buildGptMousePrompt(useTaskSystem, promptAppend)
    case "default":
    default:
      return buildDefaultMousePrompt(useTaskSystem, promptAppend)
  }
}

export function createMouseAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? systemDefaultModel ?? MOUSE_DEFAULTS.model
  const temperature = override?.temperature ?? MOUSE_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildMousePrompt(model, useTaskSystem, promptAppend)

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
      "Focused task executor. Same discipline, no delegation. (Mouse - Matrixx)",
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

  if (isAnthropicModel(model)) {
    return {
      ...base,
      thinking: { type: "enabled", budgetTokens: 32000 },
    } as AgentConfig
  }

  return base as AgentConfig
}

createMouseAgentWithOverrides.mode = MODE
