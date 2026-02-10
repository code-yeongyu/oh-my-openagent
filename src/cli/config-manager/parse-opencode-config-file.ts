import { readFileSync, statSync } from "node:fs"
import { parseJsonc } from "../../shared"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"

interface ParseConfigResult {
  config: OpenCodeConfig | null
  error?: string
}

export interface OpenCodeConfig {
  plugin?: string[]
  [key: string]: unknown
}

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0
}

export function parseOpenCodeConfigFileWithError(path: string): ParseConfigResult {
  try {
    const stat = statSync(path)
    if (stat.size === 0) {
      return { config: null, error: `Config file is empty: ${path}. Delete it or add valid JSON content.` }
    }

    const content = readFileSync(path, "utf-8")
    if (isEmptyOrWhitespace(content)) {
      return { config: null, error: `Config file contains only whitespace: ${path}. Delete it or add valid JSON content.` }
    }

    const config = parseJsonc<OpenCodeConfig>(content)

    if (config === null || config === undefined) {
      return { config: null, error: `Config file parsed to null/undefined: ${path}. Ensure it contains valid JSON.` }
    }

    if (typeof config !== "object" || Array.isArray(config)) {
      return {
        config: null,
        error: `Config file must contain a JSON object, not ${Array.isArray(config) ? "an array" : typeof config}: ${path}`,
      }
    }

    return { config }
  } catch (err) {
    return { config: null, error: formatErrorWithSuggestion(err, `parse config file ${path}`) }
  }
}
