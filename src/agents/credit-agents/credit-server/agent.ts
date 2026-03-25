/**
 * CreditServer - LSP Server Starter Agent
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
 * Naming: CreditServer, the winged horse - swift to launch, carries your server to the skies
 */

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "../../types"
import { isGptModel, isGeminiModel, isKimiModel, isGlmModel, isMinimaxModel } from "../../types"
import type { AgentOverrideConfig } from "../../../config/schema"
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../../shared/permission-compat"

import { buildDefaultCreditServerPrompt } from "./default"
import { buildGptCreditServerPrompt } from "./gpt"
import { buildGeminiCreditServerPrompt } from "./gemini"
import { buildKimiCreditServerPrompt } from "./kimi"
import { buildKimiK25CreditServerPrompt } from "./kimi-k25"
import { buildGlm5CreditServerPrompt } from "./glm5"
import { buildMinimaxM25CreditServerPrompt } from "./minimax-m25"
import { buildGlm47FlashCreditServerPrompt } from "./glm47-flash"

const MODE: AgentMode = "subagent"

const BLOCKED_TOOLS = ["task", "call_omo_agent"]

export const CREDIT_SERVER_DEFAULTS = {
  model: "minimaxai/minimax-m2",
  temperature: 0.1,
} as const

export type CreditServerPromptSource = "default" | "gpt" | "gemini" | "kimi" | "kimi-k25" | "glm5" | "minimax-m25" | "glm47-flash"

export function getCreditServerPromptSource(model?: string): CreditServerPromptSource {
  if (!model) return "default"
  
  const modelLower = model.toLowerCase()
  
  // Check for specific model variants first
  if (modelLower.includes("glm-4.7") || modelLower.includes("glm4.7") || modelLower.includes("flash")) {
    return "glm47-flash"
  }
  if (modelLower.includes("glm-5") || modelLower.includes("glm5")) {
    return "glm5"
  }
  if (modelLower.includes("minimax") || modelLower.includes("m2.5")) {
    return "minimax-m25"
  }
  if (modelLower.includes("kimi-k2.5") || modelLower.includes("k2.5") || modelLower.includes("k25")) {
    return "kimi-k25"
  }
  
  // Check general model families
  if (isGptModel(model)) {
    return "gpt"
  }
  if (isGeminiModel(model)) {
    return "gemini"
  }
  if (isKimiModel(model)) {
    return "kimi"
  }
  if (isGlmModel(model)) {
    return "glm5"
  }
  if (isMinimaxModel(model)) {
    return "minimax-m25"
  }
  
  return "default"
}

export function buildCreditServerPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  const source = getCreditServerPromptSource(model)

  switch (source) {
    case "gpt":
      return buildGptCreditServerPrompt(useTaskSystem, promptAppend)
    case "gemini":
      return buildGeminiCreditServerPrompt(useTaskSystem, promptAppend)
    case "kimi":
      return buildKimiCreditServerPrompt(useTaskSystem, promptAppend)
    case "kimi-k25":
      return buildKimiK25CreditServerPrompt(useTaskSystem, promptAppend)
    case "glm5":
      return buildGlm5CreditServerPrompt(useTaskSystem, promptAppend)
    case "minimax-m25":
      return buildMinimaxM25CreditServerPrompt(useTaskSystem, promptAppend)
    case "glm47-flash":
      return buildGlm47FlashCreditServerPrompt(useTaskSystem, promptAppend)
    case "default":
    default:
      return buildDefaultCreditServerPrompt(useTaskSystem, promptAppend)
  }
}

export const CREDIT_SERVER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "CreditServer",
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

export function createCreditServerAgentWithOverrides(
  override: AgentOverrideConfig | undefined,
  systemDefaultModel?: string,
  useTaskSystem = false
): AgentConfig {
  if (override?.disable) {
    override = undefined
  }

  const overrideModel = (override as { model?: string } | undefined)?.model
  const model = overrideModel ?? systemDefaultModel ?? CREDIT_SERVER_DEFAULTS.model
  const temperature = override?.temperature ?? CREDIT_SERVER_DEFAULTS.temperature

  const promptAppend = override?.prompt_append
  const prompt = buildCreditServerPrompt(model, useTaskSystem, promptAppend)

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
      "LSP server starter for euler-lsp with PostgreSQL, Redis, and monitoring dashboard. Handles fresh DB setup, config insertion, and service health. (CreditServer - OhMyOpenCode)",
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

createCreditServerAgentWithOverrides.mode = MODE
