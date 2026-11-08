import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  isOurFilePluginEntry,
  isOmoManagedTuiEntry,
  isServerPluginEntry,
  tuiPluginSpecName,
} from "../doctor/checks/tui-plugin-config"
import {
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigDir,
  parseJsonc,
} from "../../shared"
import { writeFileAtomically } from "../../shared/write-file-atomically"

type ConfigShape = {
  plugin?: unknown
  [key: string]: unknown
}

export type EnsureTuiPluginEntryResult = {
  readonly changed: boolean
  readonly reason: string
}

function readConfig(path: string): ConfigShape | null {
  try {
    const parsed = parseJsonc<unknown>(readFileSync(path, "utf-8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ConfigShape
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  return null
}

function readServerConfig(configDir: string): ConfigShape | null {
  const jsoncPath = join(configDir, "opencode.jsonc")
  if (existsSync(jsoncPath)) return readConfig(jsoncPath)

  const jsonPath = join(configDir, "opencode.json")
  if (existsSync(jsonPath)) return readConfig(jsonPath)

  return null
}

function pluginEntries(config: ConfigShape): unknown[] {
  if (Array.isArray(config.plugin)) return config.plugin
  if (typeof config.plugin === "string") return [config.plugin]
  return []
}

function pluginFieldInvalid(config: ConfigShape): boolean {
  return config.plugin !== undefined && !Array.isArray(config.plugin) && typeof config.plugin !== "string"
}

function serverPluginEntry(config: ConfigShape): string | undefined {
  for (const entry of pluginEntries(config)) {
    const name = tuiPluginSpecName(entry)
    if (name !== null && isServerPluginEntry(name)) return name
  }
  return undefined
}

function desiredTuiEntry(serverEntry: string): string | null {
  if (serverEntry === PLUGIN_NAME || serverEntry.startsWith(`${PLUGIN_NAME}@`)) {
    return serverEntry
  }
  if (serverEntry === LEGACY_PLUGIN_NAME || serverEntry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return serverEntry
  }
  if (serverEntry.startsWith("file:") && isOurFilePluginEntry(serverEntry)) {
    return serverEntry
  }
  return null
}

function readTuiConfig(tuiJsonPath: string): { config: ConfigShape; malformed: boolean } {
  if (!existsSync(tuiJsonPath)) {
    return { config: {}, malformed: false }
  }
  const config = readConfig(tuiJsonPath)
  return config ? { config, malformed: false } : { config: {}, malformed: true }
}

function formatConfig(config: ConfigShape): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function ensureTuiPluginEntry(opts: { configDir?: string } = {}): EnsureTuiPluginEntryResult {
  const configDir = opts.configDir ?? getOpenCodeConfigDir({ binary: "opencode", version: null })
  const serverConfig = readServerConfig(configDir)
  const serverEntry = serverConfig ? serverPluginEntry(serverConfig) : undefined
  if (!serverEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const desiredEntry = desiredTuiEntry(serverEntry)
  if (!desiredEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const tuiJsonPath = join(configDir, "tui.json")
  const { config, malformed } = readTuiConfig(tuiJsonPath)
  if (malformed || pluginFieldInvalid(config)) {
    return { changed: false, reason: "malformed" }
  }

  // Drop every entry that belongs to this plugin, whatever spec it carries, so
  // an entry an older installer wrote (`<pkg>@latest`, the legacy package name,
  // the `<pkg>/tui` subpath) cannot survive alongside the one written now and
  // load the plugin twice. Foreign entries keep their position and shape.
  const entries = pluginEntries(config)
  const otherEntries = entries.filter((entry) => !isOmoManagedTuiEntry(entry))
  const pluginIsArray = Array.isArray(config.plugin)
  const isOnlyDesiredEntry =
    pluginIsArray && entries.length === otherEntries.length + 1 && entries.includes(desiredEntry)
  if (isOnlyDesiredEntry) {
    return { changed: false, reason: "already-present" }
  }

  mkdirSync(configDir, { recursive: true })
  writeFileAtomically(tuiJsonPath, formatConfig({ ...config, plugin: [...otherEntries, desiredEntry] }))
  return { changed: true, reason: "added" }
}
