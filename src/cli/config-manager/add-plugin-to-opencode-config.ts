import { readFileSync, writeFileSync } from "node:fs"
import { applyEdits, modify } from "jsonc-parser"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME, LEGACY_PLUGIN_NAME, PUBLISHED_PACKAGE_NAME } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { getPluginNameWithVersion } from "./plugin-name-with-version"
import { checkVersionCompatibility, extractVersionFromPluginEntry } from "./version-compatibility"

const BUNDLED_SKILL_PATHS = [
  `./node_modules/${PUBLISHED_PACKAGE_NAME}/.agents/skills`,
  `./node_modules/${PLUGIN_NAME}/.agents/skills`,
] as const

interface OpenCodeSkillsConfig {
  paths?: string[]
  urls?: string[]
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function toSkillsConfig(value: unknown): OpenCodeSkillsConfig {
  if (!isRecord(value)) return {}

  return {
    ...value,
    paths: toStringArray(value.paths),
    urls: toStringArray(value.urls),
  }
}

function ensureBundledSkillPaths(config: OpenCodeConfig): void {
  const skills = toSkillsConfig(config.skills)
  const existingPaths = skills.paths ?? []
  const pathSet = new Set(existingPaths)
  const mergedPaths = [...existingPaths]

  for (const skillPath of BUNDLED_SKILL_PATHS) {
    if (!pathSet.has(skillPath)) {
      mergedPaths.push(skillPath)
      pathSet.add(skillPath)
    }
  }

  config.skills = {
    ...skills,
    paths: mergedPaths,
  }
}

function getConfiguredSkillPaths(config: OpenCodeConfig): string[] {
  return toSkillsConfig(config.skills).paths ?? [...BUNDLED_SKILL_PATHS]
}

function updateJsoncField(content: string, path: (string | number)[], value: unknown): string {
  const edits = modify(content, path, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
  })

  return edits.length === 0 ? content : applyEdits(content, edits)
}

function updateJsoncConfig(content: string, pluginEntries: string[], skillPaths: string[]): string {
  const withPlugin = updateJsoncField(content, ["plugin"], pluginEntries)
  return updateJsoncField(withPlugin, ["skills", "paths"], skillPaths)
}

export async function addPluginToOpenCodeConfig(currentVersion: string): Promise<ConfigMergeResult> {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(error, "create config directory"),
    }
  }

  const { format, path } = detectConfigFormat()
  const pluginEntry = await getPluginNameWithVersion(currentVersion, PLUGIN_NAME)

  try {
    if (format === "none") {
      const config: OpenCodeConfig = { plugin: [pluginEntry] }
      ensureBundledSkillPaths(config)
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: path }
    }

    const parseResult = parseOpenCodeConfigFileWithError(path)
    if (!parseResult.config) {
      return {
        success: false,
        configPath: path,
        error: parseResult.error ?? "Failed to parse config file",
      }
    }

    const config = parseResult.config
    const plugins = config.plugin ?? []

    const canonicalEntries = plugins.filter(
      (plugin) => plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`)
    )
    const legacyEntries = plugins.filter(
      (plugin) => plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
    )
    const otherPlugins = plugins.filter(
      (plugin) => !(plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`))
        && !(plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`))
    )

    const existingEntry = canonicalEntries[0] ?? legacyEntries[0]
    if (existingEntry) {
      const installedVersion = extractVersionFromPluginEntry(existingEntry)
      const compatibility = checkVersionCompatibility(installedVersion, currentVersion)

      if (!compatibility.canUpgrade) {
        return {
          success: false,
          configPath: path,
          error: compatibility.reason ?? "Version compatibility check failed",
        }
      }

      const backupResult = backupConfigFile(path)
      if (!backupResult.success) {
        return {
          success: false,
          configPath: path,
          error: `Failed to create backup: ${backupResult.error}`,
        }
      }
    }

    const normalizedPlugins = [...otherPlugins]

    normalizedPlugins.push(pluginEntry)

    config.plugin = normalizedPlugins
    ensureBundledSkillPaths(config)

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      writeFileSync(path, updateJsoncConfig(content, normalizedPlugins, getConfiguredSkillPaths(config)))
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: path }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(error, "update opencode config"),
    }
  }
}
