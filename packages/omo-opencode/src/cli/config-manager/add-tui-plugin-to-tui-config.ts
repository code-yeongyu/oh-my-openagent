import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  isOurFilePluginEntry,
  isNamedTuiPluginEntry,
  isServerPluginEntry,
} from "../doctor/checks/tui-plugin-config"
import {
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigDir,
  parseJsonc,
} from "../../shared"
import { writeFileAtomically } from "../../shared/write-file-atomically"

type ConfigShape = {
  plugin?: string[]
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

function pluginEntries(config: ConfigShape): string[] {
  return Array.isArray(config.plugin)
    ? config.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
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
  const serverEntry = serverConfig ? pluginEntries(serverConfig).find(isServerPluginEntry) : undefined
  if (!serverEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const desiredEntry = desiredTuiEntry(serverEntry)
  if (!desiredEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const tuiJsonPath = join(configDir, "tui.json")
  const { config, malformed } = readTuiConfig(tuiJsonPath)
  if (malformed) {
    return { changed: false, reason: "malformed" }
  }

  const plugins = pluginEntries(config).filter((entry) => !isNamedTuiPluginEntry(entry))
  if (plugins.includes(desiredEntry)) {
    return { changed: false, reason: "already-present" }
  }

  mkdirSync(configDir, { recursive: true })
  writeFileAtomically(tuiJsonPath, formatConfig({ ...config, plugin: [...plugins, desiredEntry] }))
  return { changed: true, reason: "added" }
}
