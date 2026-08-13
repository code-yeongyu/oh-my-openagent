import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { applyEdits, modify } from "jsonc-parser/lib/esm/main.js"
import { ATLAS_CLOUD_MODELS, ATLAS_CLOUD_PROVIDER_ID } from "@oh-my-opencode/model-core"
import type { ConfigMergeResult } from "../types"
import { backupConfigFile } from "./backup-config"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"

const FORMATTING_OPTIONS = { eol: "\n", insertSpaces: true, tabSize: 2 }

const ATLAS_CLOUD_PROVIDER_CONFIG = {
  npm: "@ai-sdk/openai-compatible",
  name: "Atlas Cloud",
  options: {
    baseURL: "https://api.atlascloud.ai/v1",
    apiKey: "{env:ATLASCLOUD_API_KEY}",
  },
  models: Object.fromEntries(
    ATLAS_CLOUD_MODELS.map((model) => [
      model.id,
      {
        name: model.name,
        ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
        ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
        ...(model.toolCall === undefined ? {} : { tool_call: model.toolCall }),
        modalities: { input: model.input, output: ["text"] },
        limit: { context: model.context, output: model.output },
      },
    ]),
  ),
}

export function addAtlasCloudProviderToOpenCodeConfig(): ConfigMergeResult {
  ensureConfigDirectoryExists()
  const target = detectConfigFormat()

  try {
    if (target.format === "none") {
      writeFileSync(
        target.path,
        `${JSON.stringify({ $schema: "https://opencode.ai/config.json", provider: { [ATLAS_CLOUD_PROVIDER_ID]: ATLAS_CLOUD_PROVIDER_CONFIG } }, null, 2)}\n`,
      )
      return { success: true, configPath: target.path }
    }

    const parsed = parseOpenCodeConfigFileWithError(target.path)
    if (!parsed.config) {
      return { success: false, configPath: target.path, error: parsed.error ?? "Failed to parse config file" }
    }
    const providers = parsed.config.provider
    if (providers && typeof providers === "object" && !Array.isArray(providers) && ATLAS_CLOUD_PROVIDER_ID in providers) {
      return { success: true, configPath: target.path }
    }

    const backup = backupConfigFile(target.path)
    if (!backup.success) {
      return { success: false, configPath: target.path, error: `Failed to create backup: ${backup.error}` }
    }

    const content = readFileSync(target.path, "utf-8")
    const next = applyEdits(
      content,
      modify(content, ["provider", ATLAS_CLOUD_PROVIDER_ID], ATLAS_CLOUD_PROVIDER_CONFIG, { formattingOptions: FORMATTING_OPTIONS }),
    )
    writeFileSync(target.path, next)
    return { success: true, configPath: target.path }
  } catch (error) {
    return {
      success: false,
      configPath: existsSync(target.path) ? target.path : getConfigDir(),
      error: formatErrorWithSuggestion(error, "add Atlas Cloud provider to opencode config"),
    }
  }
}
