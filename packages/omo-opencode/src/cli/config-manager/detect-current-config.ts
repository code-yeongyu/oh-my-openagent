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
  hasBailianCodingPlan: boolean
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
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
      hasBailianCodingPlan: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
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
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
      }
    }

    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')
    const hasOpencodeGo = configStr.includes('"opencode-go/')
    const hasBailianCodingPlan = configStr.includes('"bailian-coding-plan/')
    const hasMinimaxCnCodingPlan = configStr.includes('"minimax-cn-coding-plan/')
    const hasMinimaxCodingPlan = configStr.includes('"minimax-coding-plan/')
    const hasVercelAiGateway = configStr.includes('"vercel/')

    return {
      hasOpenAI,
      hasOpencodeZen,
      hasZaiCodingPlan,
      hasKimiForCoding,
      hasOpencodeGo,
      hasBailianCodingPlan,
      hasMinimaxCnCodingPlan,
      hasMinimaxCodingPlan,
      hasVercelAiGateway,
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        hasOpenAI: true,
        hasOpencodeZen: true,
        hasZaiCodingPlan: false,
        hasKimiForCoding: false,
        hasOpencodeGo: false,
        hasBailianCodingPlan: false,
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        hasVercelAiGateway: false,
      }
    }
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasBailianCodingPlan: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      hasVercelAiGateway: false,
    }
  }
}

function isPackageOmoPluginEntry(plugin: unknown): boolean {
  if (typeof plugin !== 'string') return false
  return plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`) ||
    plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

function isSourceOmoPluginEntry(plugin: unknown): boolean {
  if (typeof plugin !== 'string') return false
  const normalized = plugin.toLowerCase().replaceAll("\\", "/")
  if (!normalized.startsWith("file://")) return false

  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized)
}

function isOurPlugin(plugin: unknown): boolean {
  return isPackageOmoPluginEntry(plugin) || isSourceOmoPluginEntry(plugin)
}

function findOurPluginEntry(plugins: readonly unknown[]): string | null {
  return plugins.find(isOurPlugin) as string | null
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
    hasCodex: false,
    hasOpencodeZen: true,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
    hasBailianCodingPlan: false,
    hasMinimaxCnCodingPlan: false,
    hasMinimaxCodingPlan: false,
    hasVercelAiGateway: false,
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
  result.hasGemini = providers ? "google" in providers : false

  const {
    hasOpenAI,
    hasOpencodeZen,
    hasZaiCodingPlan,
    hasKimiForCoding,
    hasOpencodeGo,
    hasBailianCodingPlan,
    hasMinimaxCnCodingPlan,
    hasMinimaxCodingPlan,
    hasVercelAiGateway,
  } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding
  result.hasOpencodeGo = hasOpencodeGo
  result.hasBailianCodingPlan = hasBailianCodingPlan
  result.hasMinimaxCnCodingPlan = hasMinimaxCnCodingPlan
  result.hasMinimaxCodingPlan = hasMinimaxCodingPlan
  result.hasVercelAiGateway = hasVercelAiGateway

  return result
}
