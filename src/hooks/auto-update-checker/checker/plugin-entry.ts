import * as fs from "node:fs"
import type { OpencodeConfig } from "../types"
import { PACKAGE_NAME } from "../constants"
import { getConfigPaths } from "./config-paths"
import { stripJsonComments } from "./jsonc-strip"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../../shared/plugin-identity"

export interface PluginEntryInfo {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
}

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
const MATCH_PLUGIN_NAMES = [PACKAGE_NAME, PLUGIN_NAME, LEGACY_PLUGIN_NAME]

export function findPluginEntry(directory: string): PluginEntryInfo | null {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        for (const pluginName of MATCH_PLUGIN_NAMES) {
          if (entry === pluginName) {
            return { entry, isPinned: false, pinnedVersion: null, configPath }
          }
          if (entry.startsWith(`${pluginName}@`)) {
            const pinnedVersion = entry.slice(pluginName.length + 1)
            const isPinned = EXACT_SEMVER_REGEX.test(pinnedVersion.trim())
            return { entry, isPinned, pinnedVersion, configPath }
          }
        }
      }
    } catch {
      continue
    }
  }

  return null
}
