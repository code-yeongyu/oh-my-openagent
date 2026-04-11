import { join } from "path"
import { existsSync } from "fs"
import { getClaudeConfigDir } from "../../shared"
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
  UserPromptSubmit?: RawHookMatcher[]
  Stop?: RawHookMatcher[]
  PreCompact?: RawHookMatcher[]
}

function normalizeHookMatcher(raw: RawHookMatcher): HookMatcher {
  return {
    matcher: raw.matcher ?? raw.pattern ?? "*",
    hooks: Array.isArray(raw.hooks) ? raw.hooks : [],
  }
}

function normalizeHooksConfig(raw: RawClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = {}
  const eventTypes: (keyof RawClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
  ]

  for (const eventType of eventTypes) {
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
  const eventTypes: (keyof ClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
  ]
  for (const eventType of eventTypes) {
    if (override[eventType]) {
      result[eventType] = [...(base[eventType] || []), ...override[eventType]]
    }
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
        const content = await Bun.file(settingsPath).text()
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

  const resolvedConfig = Object.keys(mergedConfig).length > 0 ? mergedConfig : null
  configCache.set(cacheKey, {
    value: resolvedConfig,
    cachedAt: Date.now(),
  })
  return resolvedConfig
}
