import { readFileSync, writeFileSync } from "node:fs"
import type { ConfigMergeResult } from "../types"
import { PLUGIN_NAME, LEGACY_PLUGIN_NAME } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { getPluginNameWithVersion } from "./plugin-name-with-version"
import { checkVersionCompatibility, extractVersionFromPluginEntry } from "./version-compatibility"

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

  const { format, path } = detectConfigFormat()
  const pluginEntry = await getPluginNameWithVersion(currentVersion, PLUGIN_NAME)

  try {
    if (format === "none") {
      const config: OpenCodeConfig = { plugin: [pluginEntry] }
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

    if (canonicalEntries.length > 0 || legacyEntries.length > 0) {
      normalizedPlugins.push(pluginEntry)
    } else {
      normalizedPlugins.push(pluginEntry)
    }

    config.plugin = normalizedPlugins

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      const pluginArrayRegex = /((?:"plugin"|plugin)\s*:\s*)\[([\s\S]*?)\]/
      const match = content.match(pluginArrayRegex)

      if (match) {
        const formattedPlugins = normalizedPlugins.map((p) => `"${p}"`).join(",\n    ")
        const newContent = content.replace(pluginArrayRegex, `$1[\n    ${formattedPlugins}\n  ]`)
        writeFileSync(path, newContent)
      } else {
        const newContent = content.replace(/(\{)/, `$1\n  "plugin": ["${pluginEntry}"],`)
        writeFileSync(path, newContent)
      }
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "update opencode config"),
    }
  }
}
