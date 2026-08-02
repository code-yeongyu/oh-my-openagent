import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat, type ConfigFormat } from "./opencode-config-format"
import { isPackageOmoPluginEntry, parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { getPluginNameWithVersion } from "./plugin-name-with-version"
import { checkVersionCompatibility, extractVersionFromPluginEntry } from "./version-compatibility"

type ConfigTarget = {
  readonly format: ConfigFormat
  readonly path: string
  readonly primary: boolean
}

function detectConfigFormatInDir(configDir: string): { readonly format: ConfigFormat; readonly path: string } {
  const configJsonc = join(configDir, "opencode.jsonc")
  const configJson = join(configDir, "opencode.json")

  if (existsSync(configJsonc)) {
    return { format: "jsonc", path: configJsonc }
  }
  if (existsSync(configJson)) {
    return { format: "json", path: configJson }
  }
  return { format: "none", path: configJson }
}

function getParentConfigDirForProfile(configDir: string): string | null {
  const parentDir = dirname(configDir)
  if (basename(parentDir) !== "profiles") return null
  return dirname(parentDir)
}

function listProfileConfigDirs(rootConfigDir: string): string[] {
  const profilesDir = join(rootConfigDir, "profiles")
  if (!existsSync(profilesDir)) return []

  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(profilesDir, entry.name))
    .filter((profileDir) => detectConfigFormatInDir(profileDir).format !== "none")
}

function getConfigTargets(): ConfigTarget[] {
  const primaryConfigDir = getConfigDir()
  const rootConfigDir = getParentConfigDirForProfile(primaryConfigDir) ?? primaryConfigDir
  const targetDirs = new Set<string>([primaryConfigDir])

  if (rootConfigDir !== primaryConfigDir && detectConfigFormatInDir(rootConfigDir).format !== "none") {
    targetDirs.add(rootConfigDir)
  }

  for (const profileConfigDir of listProfileConfigDirs(rootConfigDir)) {
    targetDirs.add(profileConfigDir)
  }

  return Array.from(targetDirs).map((configDir) => {
    const detected = detectConfigFormatInDir(configDir)
    return {
      ...detected,
      primary: configDir === primaryConfigDir,
    }
  })
}

function isSourceOmoPluginEntry(plugin: unknown): plugin is string {
  if (typeof plugin !== "string") return false
  const normalized = plugin.toLowerCase().replaceAll("\\", "/")
  if (!normalized.startsWith("file://")) return false

  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized)
}

// `isPackageOmoPluginEntry` is shared from `parse-opencode-config-file.ts`;
// the add-plugin path additionally matches `file://` source entries.
function isOurPlugin(plugin: unknown): plugin is string {
  return isPackageOmoPluginEntry(plugin) || isSourceOmoPluginEntry(plugin)
}

function findOurPluginEntry(plugins: readonly (string | [string, unknown])[]): string | undefined {
  return plugins.find(isOurPlugin)
}

function findSourcePluginEntryInTarget(target: ConfigTarget): string | null {
  if (target.format === "none") return null

  const parseResult = parseOpenCodeConfigFileWithError(target.path)
  const plugins = parseResult.config?.plugin ?? []
  return plugins.find(isSourceOmoPluginEntry) ?? null
}

// Locate the bounds of the ROOT-level `plugin` array in a jsonc document.
// The previous non-greedy regex `\[([\s\S]*?)\]` had two defects this fixes:
//   1. It stopped at the first `]`, truncating the array whenever an entry
//      was itself a nested array (the documented `[name, options]` tuple
//      form), yielding a stray `]` and invalid JSON.
//   2. It matched the first textual `plugin:` regardless of nesting depth,
//      so a `plugin` key nested inside another object (e.g. an MCP server
//      config) appearing before the root array would be rewritten instead,
//      leaving the active root plugin array unchanged and omo unregistered.
// The scanner balances brackets while respecting strings and jsonc comments,
// and only accepts a `plugin:` header at object depth 1 (the root object).
function findPluginArrayBounds(content: string): { readonly start: number; readonly end: number } | null {
  const headerRegex = /(?:"plugin"|plugin)\s*:\s*(?=\[)/g
  let headerMatch: RegExpExecArray | null
  while ((headerMatch = headerRegex.exec(content)) !== null) {
    if (objectDepthAt(content, headerMatch.index) === 1) {
      const start = headerMatch.index + headerMatch[0].length
      const end = balanceArrayBrackets(content, start)
      if (end !== null) return { start, end }
    }
  }
  return null
}

// Count `{`/`}` depth over [0, pos), skipping jsonc strings and comments.
// depth 0 = outside any object; depth 1 = inside the root object; >=2 nested.
function objectDepthAt(content: string, pos: number): number {
  let depth = 0
  let i = 0
  let inString = false
  while (i < pos) {
    const ch = content[i]
    if (inString) {
      if (ch === "\\") { i += 2; continue }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') { inString = true; i += 1; continue }
    if (ch === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i)
      i = nl === -1 ? pos : Math.min(nl + 1, pos)
      continue
    }
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2)
      i = close === -1 ? pos : Math.min(close + 2, pos)
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") depth -= 1
    i += 1
  }
  return depth
}

// Given `start` pointing at `[`, return index after the matching `]` (or null
// if unbalanced), skipping jsonc strings and comments and balancing nested
// arrays (e.g. tuple entries `[name, {...}]`).
function balanceArrayBrackets(content: string, start: number): number | null {
  if (content[start] !== "[") return null
  let depth = 0
  let i = start
  let inString = false
  while (i < content.length) {
    const ch = content[i]
    if (inString) {
      if (ch === "\\") { i += 2; continue }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') { inString = true; i += 1; continue }
    if (ch === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i)
      i = nl === -1 ? content.length : nl + 1
      continue
    }
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2)
      i = close === -1 ? content.length : close + 2
      continue
    }
    if (ch === "[") depth += 1
    else if (ch === "]") {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return null
}

function choosePluginEntry(params: {
  readonly existingEntry: string | undefined
  readonly fallbackEntry: string
  readonly preferredSourceEntry: string | null
}): string {
  if (params.existingEntry && isSourceOmoPluginEntry(params.existingEntry)) {
    return params.existingEntry
  }
  if (params.preferredSourceEntry) {
    return params.preferredSourceEntry
  }
  return params.fallbackEntry
}

function writePluginEntryToTarget(params: {
  readonly target: ConfigTarget
  readonly currentVersion: string
  readonly fallbackEntry: string
  readonly preferredSourceEntry: string | null
}): ConfigMergeResult {
  const { target, currentVersion, fallbackEntry, preferredSourceEntry } = params
  const pluginEntry = choosePluginEntry({
    existingEntry: undefined,
    fallbackEntry,
    preferredSourceEntry,
  })

  try {
    if (target.format === "none") {
      const config: OpenCodeConfig = { plugin: [pluginEntry] }
      writeFileSync(target.path, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: target.path }
    }

    const parseResult = parseOpenCodeConfigFileWithError(target.path)
    if (!parseResult.config) {
      return {
        success: false,
        configPath: target.path,
        error: parseResult.error ?? "Failed to parse config file",
      }
    }

    const config = parseResult.config
    const plugins = config.plugin ?? []
    const existingEntry = findOurPluginEntry(plugins)
    const nextPluginEntry = choosePluginEntry({
      existingEntry,
      fallbackEntry,
      preferredSourceEntry,
    })

    if (existingEntry && !preferredSourceEntry) {
      const installedVersion = extractVersionFromPluginEntry(existingEntry)
      const compatibility = checkVersionCompatibility(installedVersion, currentVersion)

      if (!compatibility.canUpgrade) {
        return {
          success: false,
          configPath: target.path,
          error: compatibility.reason ?? "Version compatibility check failed",
        }
      }

      const backupResult = backupConfigFile(target.path)
      if (!backupResult.success) {
        return {
          success: false,
          configPath: target.path,
          error: `Failed to create backup: ${backupResult.error}`,
        }
      }
    }

    const normalizedPlugins = plugins.filter((plugin) => !isOurPlugin(plugin))
    normalizedPlugins.push(nextPluginEntry)

    config.plugin = normalizedPlugins

    if (target.format === "jsonc") {
      const content = readFileSync(target.path, "utf-8")
      const bounds = findPluginArrayBounds(content)

      if (bounds) {
        const formattedPlugins = normalizedPlugins.map((p) => JSON.stringify(p)).join(",\n    ")
        const newContent = content.slice(0, bounds.start) + `[\n    ${formattedPlugins}\n  ]` + content.slice(bounds.end)
        writeFileSync(target.path, newContent)
      } else {
        const newContent = content.replace(/(\{)/, `$1\n  "plugin": ["${nextPluginEntry}"],`)
        writeFileSync(target.path, newContent)
      }
    } else {
      writeFileSync(target.path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: target.path }
  } catch (err) {
    return {
      success: false,
      configPath: target.path,
      error: formatErrorWithSuggestion(err, "update opencode config"),
    }
  }
}

export async function addPluginToOpenCodeConfig(currentVersion: string): Promise<ConfigMergeResult> {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, "create config directory"),
    }
  }

  const primaryTarget = detectConfigFormat()
  const targets = getConfigTargets()
  const preferredSourceEntry = targets
    .map((target) => findSourcePluginEntryInTarget(target))
    .find((entry): entry is string => entry !== null) ?? null
  const pluginEntry = await getPluginNameWithVersion(currentVersion, PLUGIN_NAME)

  let primaryResult: ConfigMergeResult | null = null
  for (const target of targets) {
    const result = writePluginEntryToTarget({
      target,
      currentVersion,
      fallbackEntry: pluginEntry,
      preferredSourceEntry,
    })

    if (!result.success) return result
    if (target.primary) {
      primaryResult = result
    }
  }

  return primaryResult ?? { success: true, configPath: primaryTarget.path }
}
