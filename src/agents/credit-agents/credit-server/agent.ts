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
import {
  createAgentToolRestrictions,
  type PermissionValue,
} from "../../../shared/permission-compat"

import { buildDefaultCreditServerPrompt } from "./default"
import { buildOpenFastCreditServerPrompt } from "./open-fast"

const MODE: AgentMode = "primary"

const BLOCKED_TOOLS = ["task", "call_omo_agent"]

export const CREDIT_SERVER_DEFAULTS = {
  model: "open-fast",
  temperature: 0.1,
} as const

export function buildCreditServerPrompt(
  model: string | undefined,
  useTaskSystem: boolean,
  promptAppend?: string
): string {
  if (model?.toLowerCase().includes("open-fast")) {
    return buildOpenFastCreditServerPrompt(useTaskSystem, promptAppend)
  }
  return buildDefaultCreditServerPrompt(useTaskSystem, promptAppend)
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
  passedModel: string | undefined,
  useTaskSystem = false
): AgentConfig {
  const model = passedModel ?? CREDIT_SERVER_DEFAULTS.model
  const temperature = CREDIT_SERVER_DEFAULTS.temperature
  const prompt = buildCreditServerPrompt(model, useTaskSystem)

  const baseRestrictions = createAgentToolRestrictions(BLOCKED_TOOLS)

  const basePermission = baseRestrictions.permission
  const merged: Record<string, PermissionValue> = {}
  for (const tool of BLOCKED_TOOLS) {
    merged[tool] = "deny"
  }
  const toolsConfig = { permission: { ...merged, ...basePermission } }

  const base: AgentConfig = {
    description: "LSP server starter for euler-lsp with PostgreSQL, Redis, and monitoring dashboard. Handles fresh DB setup, config insertion, and service health. (CreditServer - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature,
    maxTokens: 32000,
    prompt,
    color: "#00CED1",
    ...toolsConfig,
    fallback_models: [
      "openai/open-fast",
      "minimax-m2",
      "claude-sonnet-4-6",
      "gpt-5.4",
    ],
  }

  return {
    ...base,
    thinking: { type: "enabled", budgetTokens: 16000 },
  } as AgentConfig
}

createCreditServerAgentWithOverrides.mode = MODE
