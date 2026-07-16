import { isPlainRecord } from "@oh-my-opencode/utils"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, relative } from "node:path"

import { mergeConfigs } from "../plugin-config/config-merger"
import { parseConfigPartially } from "../plugin-config/single-config-loader"
import {
  containsPath,
  detectPluginConfigFile,
  findProjectOpencodePluginConfigFiles,
  getOpenCodeConfigDirs,
  parseJsonc,
} from "../shared"
import { applyDisabledProviders } from "../shared/disabled-providers"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../shared/plugin-identity"
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./schema"

export type PluginConfigValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly path: string | null
  readonly config: OhMyOpenCodeConfig
}

type ConfigLayer = {
  readonly path: string
  readonly configDir: string
}

type LoadedConfigLayer = ConfigLayer & {
  readonly config: Partial<OhMyOpenCodeConfig> | null
  readonly messages: readonly string[]
}

function resolveHomeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir()
}

function discoverConfigInDirectory(configDir: string): string | null {
  const detected = detectPluginConfigFile(configDir, {
    basenames: [CONFIG_BASENAME],
    legacyBasenames: [LEGACY_CONFIG_BASENAME],
  })
  return detected.format === "none" ? null : detected.path
}

function discoverUserLayers(): readonly ConfigLayer[] {
  return getOpenCodeConfigDirs({ binary: "opencode" }).flatMap((configDir) => {
    const configPath = discoverConfigInDirectory(configDir)
    return configPath ? [{ path: configPath, configDir }] : []
  })
}

function discoverProjectLayersNearestFirst(directory: string): readonly ConfigLayer[] {
  const homeDirectory = resolveHomeDirectory()
  const stopDirectory = containsPath(homeDirectory, directory) ? homeDirectory : directory
  return findProjectOpencodePluginConfigFiles(directory, stopDirectory).map((configPath) => ({
    path: configPath,
    configDir: dirname(configPath),
  }))
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
  if (result.success) return []
  return result.error.issues.map((issue) => `${shortPath(configPath)}: ${formatIssuePath(issue.path)}: ${issue.message}`)
}

function parseLayerConfig(configPath: string): LoadedConfigLayer {
  try {
    const content = readFileSync(configPath, "utf-8")
    const rawConfig = parseJsonc<unknown>(content)
    if (!isPlainRecord(rawConfig)) {
      return {
        path: configPath,
        configDir: dirname(configPath),
        config: null,
        messages: [`${shortPath(configPath)}: <root>: Expected object`],
      }
    }

    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)
    return {
      path: configPath,
      configDir: dirname(configPath),
      config: result.success ? result.data : parseConfigPartially(rawConfig),
      messages: schemaMessages(configPath, rawConfig),
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return {
      path: configPath,
      configDir: dirname(configPath),
      config: null,
      messages: [`${shortPath(configPath)}: ${error.message}`],
    }
  }
}

function firstPath(layers: readonly LoadedConfigLayer[]): string | null {
  const first = layers[0]
  return first ? first.path : null
}

function firstFailingPath(layers: readonly LoadedConfigLayer[]): string | null {
  for (const layer of layers) {
    if (layer.messages.length > 0) return layer.path
  }
  return null
}

function mergeLoadedConfig(
  userLayersNearestFirst: readonly LoadedConfigLayer[],
  projectLayersNearestFirst: readonly LoadedConfigLayer[],
): OhMyOpenCodeConfig {
  let config = OhMyOpenCodeConfigSchema.parse({})

  for (const layer of [...userLayersNearestFirst].reverse()) {
    if (layer.config) config = mergeConfigs(config, layer.config)
  }

  const userMcpEnvAllowlist = config.mcp_env_allowlist ?? []
  const userPlaywrightMcpArgs = config.browser_automation_engine?.playwright_mcp_args
  for (const layer of [...projectLayersNearestFirst].reverse()) {
    if (layer.config) config = mergeConfigs(config, layer.config)
  }

  config = { ...config, mcp_env_allowlist: userMcpEnvAllowlist }
  if (config.browser_automation_engine) {
    const {
      playwright_mcp_args: _projectPlaywrightMcpArgs,
      ...browserAutomationEngine
    } = config.browser_automation_engine
    config = {
      ...config,
      browser_automation_engine: userPlaywrightMcpArgs !== undefined
        ? { ...browserAutomationEngine, playwright_mcp_args: userPlaywrightMcpArgs }
        : browserAutomationEngine,
    }
  }
  return applyDisabledProviders(config)
}

export function validatePluginConfig(directory: string): PluginConfigValidation {
  const userLayersNearestFirst = discoverUserLayers().map((layer) => parseLayerConfig(layer.path))
  const projectLayersNearestFirst = discoverProjectLayersNearestFirst(directory).map((layer) => parseLayerConfig(layer.path))
  const layers = [...userLayersNearestFirst, ...projectLayersNearestFirst]
  const messages = layers.flatMap((layer) => layer.messages)

  return {
    valid: messages.length === 0,
    messages,
    path: firstFailingPath(layers) ?? firstPath(layers),
    config: mergeLoadedConfig(userLayersNearestFirst, projectLayersNearestFirst),
  }
}
