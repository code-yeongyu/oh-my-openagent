import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { parseJsonc } from "../shared"
import { ensureConfigDirectoryExists } from "./config-manager/ensure-config-directory-exists"
import { getOmoConfigPath } from "./config-manager/config-context"
import { deepMergeRecord } from "./config-manager/deep-merge-record"

export interface EnableDisableResult {
  success: boolean
  configPath: string
  error?: string
}

function setPluginEnabled(enabled: boolean): EnableDisableResult {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return {
      success: false,
      configPath: "",
      error: err instanceof Error ? err.message : "Failed to ensure config directory exists",
    }
  }

  const configPath = getOmoConfigPath()

  try {
    const patch: Record<string, unknown> = { plugin: { enabled } }

    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8")
      const existing = parseJsonc<Record<string, unknown>>(content)
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        const merged = deepMergeRecord(existing, patch)
        writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n")
      } else {
        writeFileSync(configPath, JSON.stringify(patch, null, 2) + "\n")
      }
    } else {
      writeFileSync(configPath, JSON.stringify(patch, null, 2) + "\n")
    }

    return { success: true, configPath }
  } catch (err) {
    return {
      success: false,
      configPath,
      error: err instanceof Error ? err.message : "Failed to write config",
    }
  }
}

export function enablePlugin(): EnableDisableResult {
  return setPluginEnabled(true)
}

export function disablePlugin(): EnableDisableResult {
  return setPluginEnabled(false)
}
