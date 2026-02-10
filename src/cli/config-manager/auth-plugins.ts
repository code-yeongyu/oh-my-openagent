import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs"
import { modify, applyEdits } from "jsonc-parser"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { parseJsonc } from "../../shared/jsonc-parser"

export async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
    if (!res.ok) return null
    const data = (await res.json()) as { version: string }
    return data.version
  } catch {
    return null
  }
}

export async function addAuthPlugins(config: InstallConfig): Promise<ConfigMergeResult> {
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
  const backupPath = `${path}.bak`

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

    const rawPlugins = existingConfig?.plugin
    const plugins: string[] = Array.isArray(rawPlugins) ? rawPlugins : []

    if (config.hasGemini) {
      const version = await fetchLatestVersion("opencode-antigravity-auth")
      const pluginEntry = version ? `opencode-antigravity-auth@${version}` : "opencode-antigravity-auth"
      if (!plugins.some((p) => p.startsWith("opencode-antigravity-auth"))) {
        plugins.push(pluginEntry)
      }
    }

    const newConfig = { ...(existingConfig ?? {}), plugin: plugins }

    if (format !== "none" && existsSync(path)) {
      copyFileSync(path, backupPath)
    }

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")

      const newContent = applyEdits(
        content,
        modify(content, ["plugin"], plugins, {
          formattingOptions: { tabSize: 2, insertSpaces: true },
        })
      )

      try {
        parseJsonc(newContent)
      } catch (error) {
        if (existsSync(backupPath)) {
          copyFileSync(backupPath, path)
        }
        throw new Error(`Generated JSONC is invalid: ${error instanceof Error ? error.message : String(error)}`)
      }

      try {
        writeFileSync(path, newContent)
      } catch (error) {
        const hasBackup = existsSync(backupPath)
        try {
          if (hasBackup) {
            copyFileSync(backupPath, path)
          }
        } catch (restoreError) {
          return {
            success: false,
            configPath: path,
            error: `Failed to write config file, and restore from backup failed: ${String(error)}; restore error: ${String(restoreError)}`,
          }
        }

        return {
          success: false,
          configPath: path,
          error: hasBackup
            ? `Failed to write config file. Restored from backup: ${String(error)}`
            : `Failed to write config file. No backup was available: ${String(error)}`,
        }
      }
    } else {
      const nextContent = JSON.stringify(newConfig, null, 2) + "\n"
      try {
        writeFileSync(path, nextContent)
      } catch (error) {
        const hasBackup = existsSync(backupPath)
        try {
          if (hasBackup) {
            copyFileSync(backupPath, path)
          }
        } catch (restoreError) {
          return {
            success: false,
            configPath: path,
            error: `Failed to write config file, and restore from backup failed: ${String(error)}; restore error: ${String(restoreError)}`,
          }
        }

        return {
          success: false,
          configPath: path,
          error: hasBackup
            ? `Failed to write config file. Restored from backup: ${String(error)}`
            : `Failed to write config file. No backup was available: ${String(error)}`,
        }
      }
    }
    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "add auth plugins to config"),
    }
  }
}
