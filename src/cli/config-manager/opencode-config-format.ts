import { existsSync } from "node:fs"
import { getConfigJson, getConfigJsonc } from "./config-context"

export type ConfigFormat = "json" | "jsonc" | "none"

export function detectConfigFormat(): { format: ConfigFormat; path: string } {
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
