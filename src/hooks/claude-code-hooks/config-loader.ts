import { existsSync } from "fs"
import { join } from "path"
import type { ClaudeHookEvent } from "./types"
import { log } from "../../shared/logger"
import { getOpenCodeConfigDir } from "../../shared"

const CONFIG_CACHE_TTL_MS = 30_000

export interface DisabledHooksConfig {
  Stop?: string[]
  PreToolUse?: string[]
  PostToolUse?: string[]
  UserPromptSubmit?: string[]
  PreCompact?: string[]
}

export interface PluginExtendedConfig {
  disabledHooks?: DisabledHooksConfig
}

interface PluginExtendedConfigCacheEntry {
  value: PluginExtendedConfig
  cachedAt: number
}

const configCache = new Map<string, PluginExtendedConfigCacheEntry>()

function getUserConfigPath(): string {
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "opencode-cc-plugin.json")
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".opencode", "opencode-cc-plugin.json")
}

function getCacheKey(): string {
  return `${process.cwd()}::${getUserConfigPath()}`
}

function getCachedConfig(cacheKey: string): PluginExtendedConfig | undefined {
  const cachedEntry = configCache.get(cacheKey)
  if (!cachedEntry) {
    return undefined
  }

  if (Date.now() - cachedEntry.cachedAt >= CONFIG_CACHE_TTL_MS) {
    configCache.delete(cacheKey)
    return undefined
  }

  return cachedEntry.value
}

export function clearPluginExtendedConfigCache(): void {
  configCache.clear()
}

async function loadConfigFromPath(path: string): Promise<PluginExtendedConfig | null> {
  if (!existsSync(path)) {
    return null
  }

  try {
    const content = await Bun.file(path).text()
    return JSON.parse(content) as PluginExtendedConfig
  } catch (error) {
    log("Failed to load config", { path, error })
    return null
  }
}

function mergeDisabledHooks(
  base: DisabledHooksConfig | undefined,
  override: DisabledHooksConfig | undefined
): DisabledHooksConfig {
  if (!override) return base ?? {}
  if (!base) return override

  return {
    Stop: override.Stop ?? base.Stop,
    PreToolUse: override.PreToolUse ?? base.PreToolUse,
    PostToolUse: override.PostToolUse ?? base.PostToolUse,
    UserPromptSubmit: override.UserPromptSubmit ?? base.UserPromptSubmit,
    PreCompact: override.PreCompact ?? base.PreCompact,
  }
}

export async function loadPluginExtendedConfig(): Promise<PluginExtendedConfig> {
  const cacheKey = getCacheKey()
  const cachedConfig = getCachedConfig(cacheKey)
  if (cachedConfig) {
    return cachedConfig
  }

  const userConfig = await loadConfigFromPath(getUserConfigPath())
  const projectConfig = await loadConfigFromPath(getProjectConfigPath())

  const merged: PluginExtendedConfig = {
    disabledHooks: mergeDisabledHooks(
      userConfig?.disabledHooks,
      projectConfig?.disabledHooks
    ),
  }

  if (userConfig || projectConfig) {
    log("Plugin extended config loaded", {
      userConfigExists: userConfig !== null,
      projectConfigExists: projectConfig !== null,
      mergedDisabledHooks: merged.disabledHooks,
    })
  }

  configCache.set(cacheKey, {
    value: merged,
    cachedAt: Date.now(),
  })

  return merged
}

const regexCache = new Map<string, RegExp>()

function getRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    try {
      regex = new RegExp(pattern)
      regexCache.set(pattern, regex)
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      regexCache.set(pattern, regex)
    }
  }
  return regex
}

export function isHookCommandDisabled(
  eventType: ClaudeHookEvent,
  command: string,
  config: PluginExtendedConfig | null
): boolean {
  if (!config?.disabledHooks) return false

  const patterns = config.disabledHooks[eventType]
  if (!patterns || patterns.length === 0) return false

  return patterns.some((pattern) => {
    const regex = getRegex(pattern)
    return regex.test(command)
  })
}
