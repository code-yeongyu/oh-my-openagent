import * as fs from "node:fs"
import type { OpencodeConfig } from "../types"
import { PACKAGE_NAME } from "../constants"
import { getConfigPaths } from "./config-paths"
import { stripJsonComments } from "./jsonc-strip"

export interface PluginEntryInfo {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
}

export function findPluginEntry(directory: string): PluginEntryInfo | null {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        if (entry === PACKAGE_NAME) {
          return { entry, isPinned: false, pinnedVersion: null, configPath }
        }
        if (entry.startsWith(`${PACKAGE_NAME}@`)) {
          const pinnedVersion = entry.slice(PACKAGE_NAME.length + 1)
          const isPinned = pinnedVersion !== "latest"
          return { entry, isPinned, pinnedVersion: isPinned ? pinnedVersion : null, configPath }
        }
      }
    } catch {
      continue
    }
  }

  return null
}
