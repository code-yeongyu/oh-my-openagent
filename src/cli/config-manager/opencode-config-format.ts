import { existsSync } from "node:fs"
import { join } from "path"
import { getConfigJson, getConfigJsonc } from "./config-context"

export type ConfigFormat = "json" | "jsonc" | "none"

export function detectConfigFormat(directory?: string): { format: ConfigFormat; path: string } {
  if (directory) {
    const configJsonc = join(directory, "opencode.jsonc")
    const configJson = join(directory, "opencode.json")

    if (existsSync(configJsonc)) {
      return { format: "jsonc", path: configJsonc }
    }
    if (existsSync(configJson)) {
      return { format: "json", path: configJson }
    }
    return { format: "none", path: configJson }
  }

  const configJsonc = getConfigJsonc()
  const configJson = getConfigJson()

  if (existsSync(configJsonc)) {
    return { format: "jsonc", path: configJsonc }
  }
  if (existsSync(configJson)) {
    return { format: "json", path: configJson }
  }
  return { format: "none", path: configJson }
}