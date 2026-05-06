import { existsSync, readFileSync } from "node:fs"
import { parseJsonc, LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared"
import type { DetectedConfig } from "../types"
import { getOmoConfigPath } from "./config-context"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"
import { extractVersionFromPluginEntry } from "./version-compatibility"

function detectProvidersFromOmoConfig(): {
  hasOpenAI: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasOpencodeGo: boolean
  hasOpenRouter: boolean
  hasVercelAiGateway: boolean
} {
  const omoConfigPath = getOmoConfigPath()
  if (!existsSync(omoConfigPath)) {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasOpenRouter: false,
      hasVercelAiGateway: false,
    }
  }

  try {
    const content = readFileSync(omoConfigPath, "utf-8")
    const omoConfig = parseJsonc<Record<string, unknown>>(content)
    if (!omoConfig || typeof omoConfig !== "object") {
      return {
        hasOpenAI: true,
        hasOpencodeZen: true,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasOpenRouter: false,
        hasVercelAiGateway: false,
      }
    }

    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')
    const hasOpencodeGo = configStr.includes('"opencode-go/')
    const hasOpenRouter = configStr.includes('"openrouter/')
    const hasVercelAiGateway = configStr.includes('"vercel/')

    return { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding, hasOpencodeGo, hasOpenRouter, hasVercelAiGateway }
  } catch {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasOpenRouter: false,
      hasVercelAiGateway: false,
    }
  }
}

function isOurPlugin(plugin: string): boolean {
  return plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`) ||
         plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function findOurPluginEntry(plugins: string[]): string | null {
  return plugins.find(isOurPlugin) ?? null
}

function hasProviderConfig(providers: Record<string, unknown> | undefined, providerName: string): boolean {
  return providers ? providerName in providers : false
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    installedVersion: null,
    hasClaude: true,
    isMax20: true,
    hasOpenAI: true,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: true,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
    hasOpenRouter: false,
    hasVercelAiGateway: false,
    enableCaveman: false,
  }

  const { format, path } = detectConfigFormat()
  if (format === "none") {
    return result
  }

  const parseResult = parseOpenCodeConfigFileWithError(path)
  if (!parseResult.config) {
    return result
  }

  const openCodeConfig = parseResult.config
  const plugins = openCodeConfig.plugin ?? []
  const ourPluginEntry = findOurPluginEntry(plugins)
  result.isInstalled = !!ourPluginEntry

  if (ourPluginEntry) {
    result.installedVersion = extractVersionFromPluginEntry(ourPluginEntry)
  }

  if (!result.isInstalled) {
    return result
  }

  const providers = openCodeConfig.provider as Record<string, unknown> | undefined
  result.hasGemini = hasProviderConfig(providers, "google")

  const { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding, hasOpencodeGo, hasOpenRouter, hasVercelAiGateway } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding
  result.hasOpencodeGo = hasOpencodeGo
  result.hasOpenRouter = hasOpenRouter || hasProviderConfig(providers, "openrouter")
  result.hasVercelAiGateway = hasVercelAiGateway

  // Detect caveman from global_prompt_append in OMO config
  result.enableCaveman = detectCavemanFromOmoConfig()

  return result
}

function detectCavemanFromOmoConfig(): boolean {
  const omoConfigPath = getOmoConfigPath()
  if (!existsSync(omoConfigPath)) return false

  try {
    const content = readFileSync(omoConfigPath, "utf-8")
    const omoConfig = parseJsonc<Record<string, unknown>>(content)
    if (!omoConfig || typeof omoConfig !== "object") return false

    const gpa = omoConfig.global_prompt_append
    return typeof gpa === "string" && gpa.includes("CAVEMAN")
  } catch {
    return false
  }
}
