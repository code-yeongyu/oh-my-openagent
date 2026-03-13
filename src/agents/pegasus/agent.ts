/**
 * Pegasus - LSP Server Starter Agent
 *
 * Specialized agent for starting the euler-lsp server and its dependencies
 * (PostgreSQL, Redis). Handles fresh setup, database initialization, config
 * insertion, service monitoring, and the monitoring dashboard.
 *
 * Key characteristics:
 * - Starts euler-lsp server and all dependencies via process-compose
 * - Manages fresh database setup and required config insertion
 * - Monitors service health and troubleshoots startup issues
 * - Starts and manages the service monitoring dashboard
 * - Handles graceful shutdown and restart of services
 *
 * Naming: Pegasus, the winged horse - swift to launch, carries your server to the skies
 */

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { isGptModel, isGeminiModel, isKimiModel } from "../types"
import type { AgentOverrideConfig } from "../../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../shared/permission-compat"

import { buildDefaultPegasusPrompt } from "./default"
import { buildGptPegasusPrompt } from "./gpt"
import { buildGeminiPegasusPrompt } from "./gemini"
import { buildKimiPegasusPrompt } from "./kimi"

const MODE: AgentMode = "all"

const BLOCKED_TOOLS = ["task", "call_omo_agent"]

export const PEGASUS_DEFAULTS = {
  model: "anthropic/claude-sonnet-4-6",
  temperature: 0.1,
} as const

export type PegasusPromptSource = "default" | "gpt" | "gemini" | "kimi"

export function getPegasusPromptSource(model?: string): PegasusPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  if (model && isGeminiModel(model)) {
    return "gemini"
  }
  if (model && isKimiModel(model)) {
    return "kimi"
  }
  return "default"
}

export function buildPegasusPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getPegasusPromptSource(model)

  switch (source) {
    case "gpt":
      return buildGptPegasusPrompt(useTaskSystem, promptAppend)
    case "gemini":
      return buildGeminiPegasusPrompt(useTaskSystem, promptAppend)
    case "kimi":
      return buildKimiPegasusPrompt(useTaskSystem, promptAppend)
    case "default":
    default:
      return buildDefaultPegasusPrompt(useTaskSystem, promptAppend)
  }
}

export const PEGASUS_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Pegasus",
  triggers: [
    {
      domain: "LSP server startup",
      trigger: "Start euler-lsp server with PostgreSQL and Redis dependencies",
    },
    {
      domain: "Database initialization",
      trigger: "Fresh DB setup, config insertion, migration runs",
    },
    {
      domain: "Service monitoring",
      trigger: "Start monitoring dashboard, health checks, log viewing",
    },
  ],
  useWhen: [
    "Need to start euler-lsp server with all dependencies",
    "Fresh database setup and initialization required",
    "Need to insert required database configs",
    "Monitoring dashboard needs to be started",
    "Service health checks and troubleshooting needed",
  ],
  avoidWhen: [
    "Production server deployment",
    "Generic development server startup",
    "Tasks not related to euler-lsp stack",
  ],
  keyTrigger: "Start euler-lsp server, DB initialization, service monitoring dashboard",
}

export function createPegasusAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? systemDefaultModel ?? PEGASUS_DEFAULTS.model
  const temperature = override?.temperature ?? PEGASUS_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildPegasusPrompt(model, useTaskSystem, promptAppend)

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
      "LSP server starter for euler-lsp with PostgreSQL, Redis, and monitoring dashboard. Handles fresh DB setup, config insertion, and service health. (Pegasus - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: override?.color ?? "#00CED1",
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
    thinking: { type: "enabled", budgetTokens: 16000 },
  } as AgentConfig
}

createPegasusAgentWithOverrides.mode = MODE
