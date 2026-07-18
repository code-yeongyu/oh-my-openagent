import { existsSync } from "fs"
import { join } from "path"
import type { ClaudeHookEvent } from "./types"
import { log } from "../../shared/logger"
import { getOpenCodeConfigDirs } from "../../shared"
import { bunFile } from "../../shared/bun-file-shim"

const CONFIG_CACHE_TTL_MS = 30_000

export interface DisabledHooksConfig {
  Stop?: string[]
  PreToolUse?: string[]
  PostToolUse?: string[]
  PostToolUseFailure?: string[]
  PermissionRequest?: string[]
  UserPromptSubmit?: string[]
  Notification?: string[]
  SubagentStart?: string[]
  SubagentStop?: string[]
  SessionStart?: string[]
  SessionEnd?: string[]
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

function getUserConfigPaths(): string[] {
  return getOpenCodeConfigDirs({ binary: "opencode" }).map((dir) =>
    join(dir, "opencode-cc-plugin.json"),
  )
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".opencode", "opencode-cc-plugin.json")
}

function getCacheKey(): string {
  return `${process.cwd()}::${getUserConfigPaths().join("|")}`
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
    const content = await bunFile(path).text()
    return JSON.parse(content) as PluginExtendedConfig
  } catch (error) {
    const loggedError = error instanceof Error ? error : String(error)
    log("Failed to load config", { path, error: loggedError })
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
    PreToolUse: override.PreToolUse ?? base.PreToolUse,
    PostToolUse: override.PostToolUse ?? base.PostToolUse,
    PostToolUseFailure: override.PostToolUseFailure ?? base.PostToolUseFailure,
    PermissionRequest: override.PermissionRequest ?? base.PermissionRequest,
    UserPromptSubmit: override.UserPromptSubmit ?? base.UserPromptSubmit,
    Notification: override.Notification ?? base.Notification,
    Stop: override.Stop ?? base.Stop,
    SubagentStart: override.SubagentStart ?? base.SubagentStart,
    SubagentStop: override.SubagentStop ?? base.SubagentStop,
    SessionStart: override.SessionStart ?? base.SessionStart,
    SessionEnd: override.SessionEnd ?? base.SessionEnd,
    PreCompact: override.PreCompact ?? base.PreCompact,
  }
}

export async function loadPluginExtendedConfig(): Promise<PluginExtendedConfig> {
  const cacheKey = getCacheKey()
  const cachedConfig = getCachedConfig(cacheKey)
  if (cachedConfig) {
    return cachedConfig
  }

  // User configs: iterate reversed so custom (last in array) overrides default (first)
  const userPaths = [...getUserConfigPaths()].reverse()
  let mergedDisabledHooks: DisabledHooksConfig = {}

  for (const userPath of userPaths) {
    const userConfig = await loadConfigFromPath(userPath)
    if (userConfig?.disabledHooks) {
      mergedDisabledHooks = mergeDisabledHooks(mergedDisabledHooks, userConfig.disabledHooks)
    }
  }

  // Project config overrides all user configs
  const projectConfig = await loadConfigFromPath(getProjectConfigPath())
  if (projectConfig?.disabledHooks) {
    mergedDisabledHooks = mergeDisabledHooks(mergedDisabledHooks, projectConfig.disabledHooks)
  }

  const merged: PluginExtendedConfig = {
    disabledHooks: mergedDisabledHooks,
  }

  if (Object.keys(mergedDisabledHooks).length > 0 || projectConfig) {
    log("Plugin extended config loaded", {
      userConfigPaths: getUserConfigPaths(),
      projectConfigExists: projectConfig !== null,
      mergedDisabledHooks,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("Invalid disabled hook regex, using literal match", { pattern, error: errorMessage })
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
