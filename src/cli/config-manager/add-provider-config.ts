import { writeFileSync } from "node:fs"
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
        existingConfig = {}
      } else {
        existingConfig = parseResult.config
      }
    }

    const newConfig = { ...(existingConfig ?? {}) }
    const providers = (newConfig.provider ?? {}) as Record<string, unknown>

    if (config.hasGemini) {
      providers.google = ANTIGRAVITY_PROVIDER_CONFIG.google
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers
    }

    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "add provider config"),
    }
  }
}
