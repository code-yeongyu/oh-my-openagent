import { readFileSync, writeFileSync } from "node:fs"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { ANTIGRAVITY_PROVIDER_CONFIG } from "./antigravity-provider-configuration"

export function addProviderConfig(config: InstallConfig): ConfigMergeResult {
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

  try {
    let existingConfig: OpenCodeConfig | null = null
    if (format !== "none") {
      const parseResult = parseOpenCodeConfigFileWithError(path)
      if (parseResult.error && !parseResult.config) {
        return {
          success: false,
          configPath: path,
          error: `Failed to parse config file: ${parseResult.error}`,
        }
      }
      existingConfig = parseResult.config
    }

    const newConfig = { ...(existingConfig ?? {}) }
    const providers = (newConfig.provider ?? {}) as Record<string, unknown>

    if (config.hasGemini) {
      providers.google = ANTIGRAVITY_PROVIDER_CONFIG.google
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers
    }

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")
      const providerJson = JSON.stringify(newConfig.provider, null, 2)
        .split("\n")
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join("\n")
      // Match "provider" key with any indentation and nested brace depth
      const providerIdx = content.indexOf('"provider"')
      if (providerIdx !== -1) {
        const colonIdx = content.indexOf(":", providerIdx + '"provider"'.length)
        const braceStart = content.indexOf("{", colonIdx)
        let depth = 0
        let braceEnd = braceStart
        for (let i = braceStart; i < content.length; i++) {
          if (content[i] === "{") depth++
          else if (content[i] === "}") {
            depth--
            if (depth === 0) {
              braceEnd = i
              break
            }
          }
        }
        const newContent =
          content.slice(0, providerIdx) +
          `"provider": ${providerJson}` +
          content.slice(braceEnd + 1)
        writeFileSync(path, newContent)
      } else {
        const newContent = content.replace(/(\{)/, `$1\n  "provider": ${providerJson},`)
        writeFileSync(path, newContent)
      }
    } else {
      writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    }
    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "add provider config"),
    }
  }
}
