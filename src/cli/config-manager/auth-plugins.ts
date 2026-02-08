import { writeFileSync } from "node:fs"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"

export async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`)
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

    const plugins: string[] = existingConfig?.plugin ?? []

    if (config.hasGemini) {
      const version = await fetchLatestVersion("opencode-antigravity-auth")
      const pluginEntry = version ? `opencode-antigravity-auth@${version}` : "opencode-antigravity-auth"
      if (!plugins.some((p) => p.startsWith("opencode-antigravity-auth"))) {
        plugins.push(pluginEntry)
      }
    }

    const newConfig = { ...(existingConfig ?? {}), plugin: plugins }
    writeFileSync(path, JSON.stringify(newConfig, null, 2) + "\n")
    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "add auth plugins to config"),
    }
  }
}
