import { readFileSync, writeFileSync, copyFileSync } from "node:fs"
import type { ConfigMergeResult, InstallConfig } from "../types"
import { getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { ANTIGRAVITY_PROVIDER_CONFIG } from "./antigravity-provider-configuration"
import { modifyProviderInJsonc } from "./jsonc-provider-editor"
import { parseJsonc } from "../../shared/jsonc-parser"

const DEFAULT_LOCAL_CONTEXT_LIMIT = 32768
const DEFAULT_LOCAL_OUTPUT_LIMIT = 4096

function toLocalProviderModels(config: InstallConfig["localProviderModels"][keyof InstallConfig["localProviderModels"]]): Record<string, unknown> {
  return Object.fromEntries(
    config.map((model) => [
      model.id,
      {
        name: model.name,
        limit: {
          context: model.contextLength ?? DEFAULT_LOCAL_CONTEXT_LIMIT,
          output: model.outputLength ?? DEFAULT_LOCAL_OUTPUT_LIMIT,
        },
      },
    ])
  )
}

function buildOpenAiCompatibleLocalProvider(name: string, url: string, models: InstallConfig["localProviderModels"]["lmstudio"]): Record<string, unknown> {
  return {
    type: "openai",
    url,
    name,
    models: toLocalProviderModels(models),
  }
}

function buildOllamaProvider(url: string, models: InstallConfig["localProviderModels"]["ollama"]): Record<string, unknown> {
  return {
    type: "ollama",
    url,
    name: "Ollama Local",
    models: toLocalProviderModels(models),
  }
}

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

    if (config.hasLmstudio && config.lmstudioUrl) {
      providers.lmstudio = buildOpenAiCompatibleLocalProvider(
        "LMStudio Local",
        config.lmstudioUrl,
        config.localProviderModels.lmstudio
      )
    }

    if (config.hasOllama && config.ollamaUrl) {
      providers.ollama = buildOllamaProvider(config.ollamaUrl, config.localProviderModels.ollama)
    }

    if (config.hasVllm && config.vllmUrl) {
      providers.vllm = buildOpenAiCompatibleLocalProvider(
        "vLLM Local",
        config.vllmUrl,
        config.localProviderModels.vllm
      )
    }

    if (Object.keys(providers).length > 0) {
      newConfig.provider = providers
    }

    if (format === "jsonc") {
      const content = readFileSync(path, "utf-8")

      // Backup original file
      copyFileSync(path, `${path}.bak`)

      const providerValue = (newConfig.provider ?? {}) as Record<string, unknown>
      const newContent = modifyProviderInJsonc(content, providerValue)

      // Post-write validation
      try {
        parseJsonc(newContent)
      } catch (error) {
        return {
          success: false,
          configPath: path,
          error: `Generated JSONC is invalid: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      writeFileSync(path, newContent)
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
