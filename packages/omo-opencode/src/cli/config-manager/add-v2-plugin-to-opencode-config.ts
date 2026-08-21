import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ConfigMergeResult } from "../types"
import { detectOmoHosts, type OmoHostDeps } from "../../shared"
import { backupConfigFile } from "./backup-config"
import { detectConfigFormat, type ConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"

type AddV2PluginOptions = {
  /** Absolute path of the built v2 entry (dist/v2/index.js). Required: the v2 host needs a resolvable file path. */
  readonly v2EntryPath: string
  /** Explicit config directory override; defaults to the detected user config location. */
  readonly configDir?: string
  /** Injectable host-detection deps for tests. */
  readonly hostDeps?: Partial<OmoHostDeps>
}

function resolveTarget(configDir?: string): { format: ConfigFormat; path: string } {
  if (configDir) {
    const jsoncPath = join(configDir, "opencode.jsonc")
    const jsonPath = join(configDir, "opencode.json")
    if (existsSync(jsoncPath)) return { format: "jsonc", path: jsoncPath }
    if (existsSync(jsonPath)) return { format: "json", path: jsonPath }
    return { format: "none", path: jsonPath }
  }
  return detectConfigFormat()
}

function readPluginsArray(config: Record<string, unknown>): string[] {
  const raw = config.plugins
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Registers the omo v2 entry under the v2 `plugins` config key so opencode2
 * loads it. No-ops successfully when opencode2 is absent, keeping the v1-only
 * install flow untouched. The legacy `plugin` array is never modified here:
 * opencode2 merges both keys, and v1 must keep reading its own.
 */
export async function addV2PluginToOpencodeConfig(options: AddV2PluginOptions): Promise<ConfigMergeResult> {
  const detection = detectOmoHosts(options.hostDeps)
  let target: { format: ConfigFormat; path: string }
  try {
    target = resolveTarget(options.configDir)
  } catch (err) {
    return { success: false, configPath: "", error: formatErrorWithSuggestion(err, "resolve opencode config") }
  }

  if (!detection.hasV2) {
    return { success: true, configPath: target.path }
  }

  try {
    if (options.configDir) {
      mkdirSync(options.configDir, { recursive: true })
    }

    if (target.format === "none") {
      writeFileSync(target.path, JSON.stringify({ plugins: [options.v2EntryPath] }, null, 2) + "\n")
      return { success: true, configPath: target.path }
    }

    const parseResult = parseOpenCodeConfigFileWithError(target.path)
    if (!parseResult.config) {
      return {
        success: false,
        configPath: target.path,
        error: parseResult.error ?? "Failed to parse config file",
      }
    }

    const config = parseResult.config as Record<string, unknown>
    const existingPlugins = readPluginsArray(config)

    if (existingPlugins.includes(options.v2EntryPath)) {
      return { success: true, configPath: target.path }
    }

    const backupResult = backupConfigFile(target.path)
    if (!backupResult.success) {
      return {
        success: false,
        configPath: target.path,
        error: `Failed to create backup: ${backupResult.error}`,
      }
    }

    const nextPlugins = [...existingPlugins, options.v2EntryPath]
    config.plugins = nextPlugins

    if (target.format === "jsonc") {
      const content = readFileSync(target.path, "utf-8")
      const pluginsArrayRegex = /((?:"plugins"|plugins)\s*:\s*)\[([\s\S]*?)\]/
      const match = content.match(pluginsArrayRegex)
      if (match) {
        const formattedPlugins = nextPlugins.map((entry) => `"${entry}"`).join(",\n    ")
        writeFileSync(target.path, content.replace(pluginsArrayRegex, `$1[\n    ${formattedPlugins}\n  ]`))
      } else {
        const insertion = `,\n  "plugins": [${nextPlugins.map((entry) => `"${entry}"`).join(", ")}]`
        writeFileSync(target.path, content.replace(/\}(\s*)$/, `${insertion}\n$1}`))
      }
    } else {
      writeFileSync(target.path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: target.path }
  } catch (err) {
    return {
      success: false,
      configPath: target.path,
      error: formatErrorWithSuggestion(err, "update opencode config for v2"),
    }
  }
}
