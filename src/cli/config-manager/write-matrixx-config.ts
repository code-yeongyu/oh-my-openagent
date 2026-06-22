import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { parseJsonc } from "../../shared"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir, getMatrixxConfigPath } from "./config-context"
import { deepMergeRecord } from "./deep-merge-record"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { generateMatrixxConfig } from "./generate-matrixx-config"

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0
}

export function writeMatrixxConfig(installConfig: InstallConfig): ConfigMergeResult {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, "create config directory"),
    }
  }

  const matrixxConfigPath = getMatrixxConfigPath()

  try {
    const newConfig = generateMatrixxConfig(installConfig)

    if (existsSync(matrixxConfigPath)) {
      try {
        const stat = statSync(matrixxConfigPath)
        const content = readFileSync(matrixxConfigPath, "utf-8")

        if (stat.size === 0 || isEmptyOrWhitespace(content)) {
          writeFileSync(matrixxConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: matrixxConfigPath }
        }

        const existing = parseJsonc<Record<string, unknown>>(content)
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          writeFileSync(matrixxConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: matrixxConfigPath }
        }

        const merged = deepMergeRecord(newConfig, existing)
        writeFileSync(matrixxConfigPath, JSON.stringify(merged, null, 2) + "\n")
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          writeFileSync(matrixxConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: matrixxConfigPath }
        }
        throw parseErr
      }
    } else {
      writeFileSync(matrixxConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
    }

    return { success: true, configPath: matrixxConfigPath }
  } catch (err) {
    return {
      success: false,
      configPath: matrixxConfigPath,
      error: formatErrorWithSuggestion(err, "write matrixx config"),
    }
  }
}
