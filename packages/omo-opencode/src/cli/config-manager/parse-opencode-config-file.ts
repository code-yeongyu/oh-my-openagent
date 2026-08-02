import { readFileSync, statSync } from "node:fs"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME, parseJsonc } from "../../shared"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"

interface ParseConfigResult {
  config: OpenCodeConfig | null
  error?: string
}

export interface OpenCodeConfig {
  plugin?: (string | [string, unknown])[]
  [key: string]: unknown
}

// Shared package-name predicate for the omo plugin entry. Centralized here so
// the installer's detect and add-plugin paths cannot drift apart (AGENTS.md
// flags duplicate utilities for review). Accepts `unknown` because the parsed
// `plugin` array may contain tuple entries `[name, options]`; the `typeof`
// guard skips those without throwing.
export function isPackageOmoPluginEntry(plugin: unknown): plugin is string {
  return typeof plugin === "string" && (
    plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`) ||
    plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
  )
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

    if (config == null) {
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
