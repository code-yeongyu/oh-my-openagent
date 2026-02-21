import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { getProjectOmoConfigPath, parseJsonc } from "../../shared"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir, getOmoConfigPath } from "./config-context"
import { deepMergeRecord } from "./deep-merge-record"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { generateOmoConfig } from "./generate-omo-config"

function isEmptyOrWhitespace(content: string): boolean {
  return content.trim().length === 0
}

export interface WriteOmoConfigOptions {
  project?: boolean
}

function getTargetPath(installConfig: InstallConfig, options?: WriteOmoConfigOptions): string {
  const shouldWriteProject = options?.project ?? installConfig.project ?? false
  return shouldWriteProject ? getProjectOmoConfigPath() : getOmoConfigPath()
}

export function writeOmoConfig(installConfig: InstallConfig, options?: WriteOmoConfigOptions): ConfigMergeResult {
  const omoConfigPath = getTargetPath(installConfig, options)
  const shouldWriteProject = options?.project ?? installConfig.project ?? false

  try {
    if (shouldWriteProject) {
      mkdirSync(dirname(omoConfigPath), { recursive: true })
    } else {
      ensureConfigDirectoryExists()
    }
  } catch (err) {
    return {
      success: false,
      configPath: shouldWriteProject ? dirname(omoConfigPath) : getConfigDir(),
      error: formatErrorWithSuggestion(err, "create config directory"),
    }
  }

  try {
    const newConfig = generateOmoConfig(installConfig)

    if (existsSync(omoConfigPath)) {
      try {
        const stat = statSync(omoConfigPath)
        const content = readFileSync(omoConfigPath, "utf-8")

        if (stat.size === 0 || isEmptyOrWhitespace(content)) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }

        const existing = parseJsonc<Record<string, unknown>>(content)
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }

        const merged = deepMergeRecord(existing, newConfig)
        writeFileSync(omoConfigPath, JSON.stringify(merged, null, 2) + "\n")
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
          return { success: true, configPath: omoConfigPath }
        }
        throw parseErr
      }
    } else {
      writeFileSync(omoConfigPath, JSON.stringify(newConfig, null, 2) + "\n")
    }

    return { success: true, configPath: omoConfigPath }
  } catch (err) {
    return {
      success: false,
      configPath: omoConfigPath,
      error: formatErrorWithSuggestion(err, "write oh-my-opencode config"),
    }
  }
}
