import * as fs from "node:fs"
import { fileURLToPath } from "node:url"
import type { OpencodeConfig } from "../types"
import { ACCEPTED_PACKAGE_NAMES } from "../constants"
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
        if (!entry.startsWith("file://")) continue
        if (!ACCEPTED_PACKAGE_NAMES.some(name => entry.includes(name))) continue
        try {
          return fileURLToPath(entry)
        } catch {
          return entry.replace("file://", "")
        }
      }
    } catch {
      continue
    }
  }

  return null
}
