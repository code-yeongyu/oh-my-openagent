import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { applyEdits, modify } from "jsonc-parser"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME, LEGACY_PLUGIN_NAME } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat, type ConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
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

function isSourceOmoPluginEntry(plugin: string): boolean {
  const normalized = plugin.toLowerCase().replaceAll("\\", "/")
  if (!normalized.startsWith("file://")) return false

  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized)
}

function isPackageOmoPluginEntry(plugin: string): boolean {
  return plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`) ||
    plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function isOurPlugin(plugin: string): boolean {
  return isPackageOmoPluginEntry(plugin) || isSourceOmoPluginEntry(plugin)
}

function findOurPluginEntry(plugins: readonly string[]): string | undefined {
  return plugins.find(isOurPlugin)
}

function findSourcePluginEntryInTarget(target: ConfigTarget): string | null {
  if (target.format === "none") return null

  const parseResult = parseOpenCodeConfigFileWithError(target.path)
  const plugins = parseResult.config?.plugin ?? []
  return plugins.find(isSourceOmoPluginEntry) ?? null
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
      const newContent = applyEdits(
        content,
        modify(content, ["plugin"], normalizedPlugins, {
          formattingOptions: { eol: "\n", insertSpaces: true, tabSize: 2 },
        }),
      )
      writeFileSync(target.path, newContent)
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
