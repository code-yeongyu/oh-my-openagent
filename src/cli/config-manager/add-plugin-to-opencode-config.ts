import { readFileSync, writeFileSync } from "node:fs"
import type { ConfigMergeResult } from "../types"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { getPluginNameWithVersion } from "./plugin-name-with-version"

const PACKAGE_NAME = "oh-my-opencode"

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
  const pluginEntry = await getPluginNameWithVersion(currentVersion)

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
    const existingIndex = plugins.findIndex((p) => p === PACKAGE_NAME || p.startsWith(`${PACKAGE_NAME}@`))

    if (existingIndex !== -1) {
      if (plugins[existingIndex] === pluginEntry) {
        return { success: true, configPath: path }
      }
      plugins[existingIndex] = pluginEntry
    } else {
      plugins.push(pluginEntry)
    }

    config.plugin = plugins

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      const pluginArrayRegex = /"plugin"\s*:\s*\[([\s\S]*?)\]/
      const match = content.match(pluginArrayRegex)

      if (match) {
        const formattedPlugins = plugins.map((p) => `"${p}"`).join(",\n    ")
        const newContent = content.replace(pluginArrayRegex, `"plugin": [\n    ${formattedPlugins}\n  ]`)
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
