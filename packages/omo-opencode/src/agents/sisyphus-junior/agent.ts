import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { isGlmModel, isGptModel, buildClaudeThinkingConfig } from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import { createAgentToolRestrictions, migrateAgentConfig, type PermissionValue } from "../../shared/permission-compat"
import { buildNativeAgentPrompt, getNativePromptSource } from "../native-model-prompt"
import { buildOpenCodeRoleAppend } from "../opencode-role-append"
import { resolvePromptAppend } from "../builtin-agents/resolve-file-uri"

const MODE: AgentMode = "subagent"
const BLOCKED_TOOLS = ["task"]
export const SISYPHUS_JUNIOR_DEFAULTS = {
  model: "anthropic/claude-sonnet-5",
  temperature: 0.1,
} as const

export const getSisyphusJuniorPromptSource = getNativePromptSource
export type SisyphusJuniorPromptSource = ReturnType<typeof getNativePromptSource>

export function buildSisyphusJuniorPrompt(model: string | undefined, useTaskSystem: boolean, promptAppend?: string): string {
  const prompt = buildNativeAgentPrompt(model, buildOpenCodeRoleAppend("sisyphus-junior", { useTaskSystem }))
  return promptAppend ? prompt + "\n\n" + resolvePromptAppend(promptAppend) : prompt
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
  merged.call_omo_agent = "allow"
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

  if (override?.variant !== undefined) {
    base.variant = override.variant
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: override?.reasoningEffort ?? "medium" } as AgentConfig
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
