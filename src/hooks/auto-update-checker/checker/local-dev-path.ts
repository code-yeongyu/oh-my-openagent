import * as fs from "node:fs"
import { fileURLToPath } from "node:url"
import type { OpencodeConfig } from "../types"
import { PACKAGE_NAME } from "../constants"
import { getConfigPaths } from "./config-paths"
import { stripJsonComments } from "./jsonc-strip"

export function isLocalDevMode(directory: string): boolean {
  return getLocalDevPath(directory) !== null
}

export function getLocalDevPath(directory: string): string | null {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        if (entry.startsWith("file://") && entry.includes(PACKAGE_NAME)) {
          try {
            return fileURLToPath(entry)
          } catch {
            return entry.replace("file://", "")
          }
        }
      }
    } catch {
      continue
    }
  }

  return null
}
