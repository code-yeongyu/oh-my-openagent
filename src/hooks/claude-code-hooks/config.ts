import { join } from "path"
import { existsSync } from "fs"
import { getClaudeConfigDir } from "../../shared"
import { bunFile } from "../../shared/bun-file-shim"
import type { ClaudeHooksConfig, HookMatcher, HookAction } from "./types"

const CONFIG_CACHE_TTL_MS = 30_000

interface ClaudeHooksConfigCacheEntry {
  value: ClaudeHooksConfig | null
  cachedAt: number
}

const configCache = new Map<string, ClaudeHooksConfigCacheEntry>()

interface RawHookMatcher {
  matcher?: string
  pattern?: string
  hooks: HookAction[]
}

interface RawClaudeHooksConfig {
  PreToolUse?: RawHookMatcher[]
  PostToolUse?: RawHookMatcher[]
  PostToolUseFailure?: RawHookMatcher[]
  PermissionRequest?: RawHookMatcher[]
  UserPromptSubmit?: RawHookMatcher[]
  Notification?: RawHookMatcher[]
  Stop?: RawHookMatcher[]
  SubagentStart?: RawHookMatcher[]
  SubagentStop?: RawHookMatcher[]
  SessionStart?: RawHookMatcher[]
  SessionEnd?: RawHookMatcher[]
  PreCompact?: RawHookMatcher[]
}

const ALL_HOOK_EVENT_TYPES: (keyof ClaudeHooksConfig)[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
]

function normalizeHookMatcher(raw: RawHookMatcher): HookMatcher {
  return {
    matcher: raw.matcher ?? raw.pattern ?? "*",
    hooks: Array.isArray(raw.hooks) ? raw.hooks : [],
  }
}

function normalizeHooksConfig(raw: RawClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = {}

  for (const eventType of ALL_HOOK_EVENT_TYPES) {
    if (raw[eventType]) {
      result[eventType] = raw[eventType].map(normalizeHookMatcher)
    }
  }

  return result
}

export function getClaudeSettingsPaths(customPath?: string): string[] {
  const claudeConfigDir = getClaudeConfigDir()
  const paths = [
    join(claudeConfigDir, "settings.json"),
    join(process.cwd(), ".claude", "settings.json"),
    join(process.cwd(), ".claude", "settings.local.json"),
  ]

  if (customPath && existsSync(customPath)) {
    paths.unshift(customPath)
  }

  // Deduplicate paths to prevent loading the same file multiple times
  // (e.g., when cwd is the home directory)
  return [...new Set(paths)]
}

function getCacheKey(customSettingsPath?: string): string {
  return `${process.cwd()}::${customSettingsPath ?? ""}`
}

function getCachedConfig(cacheKey: string): ClaudeHooksConfig | null | undefined {
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

export function clearClaudeHooksConfigCache(): void {
  configCache.clear()
}

function mergeHooksConfig(
  base: ClaudeHooksConfig,
  override: ClaudeHooksConfig
): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = { ...base }
  for (const eventType of ALL_HOOK_EVENT_TYPES) {
    if (override[eventType]) {
      result[eventType] = [...(base[eventType] || []), ...override[eventType]]
    }
  }
  return result
}

let pendingPluginHooksConfigs: Array<{ hooks?: Record<string, unknown> }> = []

export function setPluginHooksConfigs(configs: Array<{ hooks?: Record<string, unknown> }>): void {
  pendingPluginHooksConfigs = configs
  configCache.clear()
}

function isHookAction(h: unknown): h is HookAction {
  if (typeof h !== "object" || h === null) return false
  const obj = h as Record<string, unknown>
  if (obj.type === "command" && typeof obj.command === "string") return true
  if (obj.type === "http" && typeof obj.url === "string") return true
  return false
}

interface PluginHookMatcher {
  matcher?: string
  pattern?: string
  hooks?: unknown[]
}

function isPluginHookMatcher(m: unknown): m is PluginHookMatcher {
  return typeof m === "object" && m !== null && Array.isArray((m as PluginHookMatcher).hooks)
}

export function mergePluginHooksConfigs(
  base: ClaudeHooksConfig,
  pluginHooksConfigs: Array<{ hooks?: Record<string, unknown> }>
): ClaudeHooksConfig {
  let result = { ...base }

  for (const pluginConfig of pluginHooksConfigs) {
    if (!pluginConfig.hooks) continue

    const pluginOverrides: ClaudeHooksConfig = {}
    for (const eventType of ALL_HOOK_EVENT_TYPES) {
      const pluginMatchers = pluginConfig.hooks[eventType]
      if (!Array.isArray(pluginMatchers)) continue

      const converted: HookMatcher[] = pluginMatchers
        .filter(isPluginHookMatcher)
        .map((m) => ({
          matcher: m.matcher ?? m.pattern ?? "*",
          hooks: (m.hooks ?? []).filter(isHookAction),
        }))
        .filter((m) => m.hooks.length > 0)

      if (converted.length > 0) {
        pluginOverrides[eventType] = converted
      }
    }

    result = mergeHooksConfig(result, pluginOverrides)
  }

  return result
}

export async function loadClaudeHooksConfig(
  customSettingsPath?: string
): Promise<ClaudeHooksConfig | null> {
  const cacheKey = getCacheKey(customSettingsPath)
  const cachedConfig = getCachedConfig(cacheKey)
  if (cachedConfig !== undefined) {
    return cachedConfig
  }

  const paths = getClaudeSettingsPaths(customSettingsPath)
  let mergedConfig: ClaudeHooksConfig = {}

  for (const settingsPath of paths) {
    if (existsSync(settingsPath)) {
      try {
        const content = await bunFile(settingsPath).text()
        const settings = JSON.parse(content) as { hooks?: RawClaudeHooksConfig }
        if (settings.hooks) {
          const normalizedHooks = normalizeHooksConfig(settings.hooks)
          mergedConfig = mergeHooksConfig(mergedConfig, normalizedHooks)
        }
      } catch {
        continue
      }
    }
  }

  // Merge plugin hooks configs
  if (pendingPluginHooksConfigs.length > 0) {
    mergedConfig = mergePluginHooksConfigs(mergedConfig, pendingPluginHooksConfigs)
  }

  const resolvedConfig = Object.keys(mergedConfig).length > 0 ? mergedConfig : null
  configCache.set(cacheKey, {
    value: resolvedConfig,
    cachedAt: Date.now(),
  })
  return resolvedConfig
}
