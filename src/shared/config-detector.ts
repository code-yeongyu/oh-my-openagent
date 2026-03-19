import { existsSync } from "node:fs"
import { parseJsonc } from "./jsonc-parser"
import { parseToml } from "./toml-parser"

export type ConfigFormat = "json" | "jsonc" | "toml" | "none"

const CONFIG_EXTENSIONS = ["jsonc", "json", "toml"] as const

export function detectConfigFile(basePath: string): {
  format: ConfigFormat
  path: string
} {
  for (const ext of CONFIG_EXTENSIONS) {
    const path = `${basePath}.${ext}`
    if (existsSync(path)) {
      return { format: ext, path }
    }
  }

  return { format: "none", path: `${basePath}.json` }
}

export function parseConfigContent<T = Record<string, unknown>>(
  content: string,
  format: Exclude<ConfigFormat, "none">
): T {
  if (format === "toml") {
    return parseToml<T>(content)
  }
  return parseJsonc<T>(content)
}
