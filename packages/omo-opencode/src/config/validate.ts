import { relative } from "node:path"

import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

import { applyDisabledProviders } from "../shared/disabled-providers"
import { log } from "../shared/logger"
import { loadOmoOpenCodeConfigChain } from "../plugin-config/omo-config-chain"
import { mergeConfigs } from "../plugin-config/config-merger"
import { findUnknownKeyPaths } from "../plugin-config/unknown-key-diagnostics"
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./schema"

export type PluginConfigValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly path: string | null
  readonly config: OhMyOpenCodeConfig
}

type LoadedConfigView = {
  readonly config: Partial<OhMyOpenCodeConfig>
  readonly messages: readonly string[]
  readonly path: string
}

function shortPath(configPath: string): string {
  const candidate = relative(process.cwd(), configPath)
  return candidate.length > 0 ? candidate : configPath
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  const formatted = path.map((segment) => String(segment)).join(".")
  return formatted.length > 0 ? formatted : "<root>"
}

function schemaMessages(configPath: string, rawConfig: Record<string, unknown>): readonly string[] {
  const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)
  const validationMessages = result.success
    ? []
    : result.error.issues.map((issue) => `${shortPath(configPath)}: ${formatIssuePath(issue.path)}: ${issue.message}`)
  const unknownKeyMessages = findUnknownKeyPaths(OhMyOpenCodeConfigSchema, rawConfig)
    .map((path) => `${shortPath(configPath)}: Unknown config key: ${formatIssuePath(path)}`)
  return [...validationMessages, ...unknownKeyMessages]
}

function parseConfig(rawConfig: Record<string, unknown>): Partial<OhMyOpenCodeConfig> {
  let config: Partial<OhMyOpenCodeConfig> = {}
  for (const [key, value] of Object.entries(rawConfig)) {
    const result = OhMyOpenCodeConfigSchema.safeParse({ [key]: value })
    if (!result.success) continue
    const section = Object.entries(result.data).find(([parsedKey]) => parsedKey === key)
    if (section !== undefined) config = Object.assign(config, Object.fromEntries([section]))
  }
  return config
}

function parseConfigView(path: string, rawConfig: Record<string, unknown>): LoadedConfigView {
  return {
    config: parseConfig(rawConfig),
    messages: schemaMessages(path, rawConfig),
    path,
  }
}

function mergeViews(views: readonly LoadedConfigView[]): OhMyOpenCodeConfig {
  let config = OhMyOpenCodeConfigSchema.parse({})
  for (const view of views) {
    config = mergeConfigs(config, view.config)
  }
  return config
}

function protectUserFields(
  config: OhMyOpenCodeConfig,
  userConfig: Partial<OhMyOpenCodeConfig>,
): OhMyOpenCodeConfig {
  const userMcpEnvAllowlist = userConfig?.mcp_env_allowlist ?? []
  const userPlaywrightMcpArgs = userConfig?.browser_automation_engine?.playwright_mcp_args
  const browserAutomationEngine = config.browser_automation_engine === undefined
    ? undefined
    : (() => {
      const { playwright_mcp_args: _projectPlaywrightMcpArgs, ...browser } = config.browser_automation_engine
      return browser
    })()

  return {
    ...config,
    mcp_env_allowlist: userMcpEnvAllowlist,
    ...(browserAutomationEngine === undefined
      ? {}
      : {
        browser_automation_engine: userPlaywrightMcpArgs === undefined
          ? browserAutomationEngine
          : { ...browserAutomationEngine, playwright_mcp_args: userPlaywrightMcpArgs },
      }),
  }
}

function migrateRalphLoopConfig(config: OhMyOpenCodeConfig): OhMyOpenCodeConfig {
  const legacy = config.ralph_loop
  if (legacy === undefined) return config

  const enabled = typeof legacy.enabled === "boolean" ? legacy.enabled : undefined
  const defaultMaxIterations = typeof legacy.default_max_iterations === "number" ? legacy.default_max_iterations : undefined
  if (enabled === undefined && defaultMaxIterations === undefined) return config

  log("[config] ralph_loop is deprecated and will be removed in a future release. Use goal instead.")
  const existingGoal = config.goal
  return {
    ...config,
    goal: {
      enabled: existingGoal?.enabled ?? enabled ?? false,
      auto_start: existingGoal?.auto_start ?? false,
      default_max_iterations: existingGoal?.default_max_iterations ?? defaultMaxIterations ?? 100,
    },
  }
}

export function validatePluginConfig(
  directory: string,
  environment: OmoConfigEnv = process.env,
): PluginConfigValidation {
  const chain = loadOmoOpenCodeConfigChain(directory, environment)
  const views = chain.views.map((view) => parseConfigView(view.path, view.config))
  const chainMessages = chain.diagnostics.map((diagnostic) => `${shortPath(diagnostic.path)}: ${diagnostic.message}`)
  const messages = [...chainMessages, ...views.flatMap((view) => view.messages)]
  const firstFailingView = views.find((view) => view.messages.length > 0)
  const firstView = views[0]
  const userConfig = parseConfig(chain.protectedUserView)
  const config = applyDisabledProviders(protectUserFields(mergeViews(views), userConfig))

  return {
    valid: messages.length === 0,
    messages,
    path: chainMessages.length > 0 ? chain.diagnostics[0]?.path ?? null : firstFailingView?.path ?? firstView?.path ?? null,
    config: migrateRalphLoopConfig(config),
  }
}
