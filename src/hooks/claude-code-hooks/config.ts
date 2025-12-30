import { join } from "path"
import { existsSync, readFileSync, readdirSync } from "fs"
import { homedir } from "os"
import { getClaudeConfigDir } from "../../shared"
import type { ClaudeHooksConfig, HookMatcher, HookCommand } from "./types"

const CLAUDE_PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"

interface RawHookMatcher {
  matcher?: string
  pattern?: string
  hooks: HookCommand[]
}

interface RawClaudeHooksConfig {
  SessionStart?: RawHookMatcher[]
  PreToolUse?: RawHookMatcher[]
  PostToolUse?: RawHookMatcher[]
  UserPromptSubmit?: RawHookMatcher[]
  Stop?: RawHookMatcher[]
  PreCompact?: RawHookMatcher[]
  SessionEnd?: RawHookMatcher[]
}

function normalizeHookMatcher(raw: RawHookMatcher): HookMatcher {
  return {
    matcher: raw.matcher ?? raw.pattern ?? "*",
    hooks: raw.hooks,
  }
}

function normalizeHooksConfig(raw: RawClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = {}
  const eventTypes: (keyof RawClaudeHooksConfig)[] = [
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
    "SessionEnd",
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

  return paths
}

function mergeHooksConfig(
  base: ClaudeHooksConfig,
  override: ClaudeHooksConfig
): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = { ...base }
  const eventTypes: (keyof ClaudeHooksConfig)[] = [
    "SessionStart",
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
    "SessionEnd",
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

  const pluginHooks = await loadPluginHooksConfigs()
  mergedConfig = mergeHooksConfig(mergedConfig, pluginHooks)

  return Object.keys(mergedConfig).length > 0 ? mergedConfig : null
}

function resolvePluginPath(path: string, pluginRoot: string): string {
  return path.replaceAll(CLAUDE_PLUGIN_ROOT_VAR, pluginRoot)
}

function resolvePluginPaths<T>(obj: T, pluginRoot: string): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return resolvePluginPath(obj, pluginRoot) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolvePluginPaths(item, pluginRoot)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolvePluginPaths(value, pluginRoot)
    }
    return result as T
  }
  return obj
}

interface PluginInstallation {
  installPath: string
}

interface InstalledPluginsDatabase {
  version: number
  plugins: Record<string, PluginInstallation | PluginInstallation[]>
}

interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>
}

interface PluginHooksJson {
  hooks?: RawClaudeHooksConfig
}

function getPluginsBaseDir(): string {
  if (process.env.CLAUDE_PLUGINS_HOME) {
    return process.env.CLAUDE_PLUGINS_HOME
  }
  return join(homedir(), ".claude", "plugins")
}

function isPluginEnabled(
  pluginKey: string,
  enabledPlugins: Record<string, boolean> | undefined
): boolean {
  if (enabledPlugins && pluginKey in enabledPlugins) {
    return enabledPlugins[pluginKey]
  }
  return true
}

async function loadPluginHooksConfigs(): Promise<ClaudeHooksConfig> {
  let mergedConfig: ClaudeHooksConfig = {}

  const dbPath = join(getPluginsBaseDir(), "installed_plugins.json")
  if (!existsSync(dbPath)) {
    return mergedConfig
  }

  let db: InstalledPluginsDatabase
  try {
    const content = readFileSync(dbPath, "utf-8")
    db = JSON.parse(content) as InstalledPluginsDatabase
  } catch {
    return mergedConfig
  }

  let enabledPlugins: Record<string, boolean> | undefined
  const settingsPath = join(homedir(), ".claude", "settings.json")
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, "utf-8")
      const settings = JSON.parse(content) as ClaudeSettings
      enabledPlugins = settings.enabledPlugins
    } catch {
    }
  }

  for (const [pluginKey, installations] of Object.entries(db.plugins)) {
    if (!isPluginEnabled(pluginKey, enabledPlugins)) {
      continue
    }

    const installation = Array.isArray(installations) ? installations[0] : installations
    if (!installation?.installPath) continue

    const { installPath } = installation
    if (!existsSync(installPath)) continue

    const hooksPath = join(installPath, "hooks", "hooks.json")
    if (!existsSync(hooksPath)) continue

    try {
      const content = readFileSync(hooksPath, "utf-8")
      let config = JSON.parse(content) as PluginHooksJson
      config = resolvePluginPaths(config, installPath)

      if (config.hooks) {
        const normalizedHooks = normalizeHooksConfig(config.hooks)
        mergedConfig = mergeHooksConfig(mergedConfig, normalizedHooks)
      }
    } catch {
      continue
    }
  }

  return mergedConfig
}
