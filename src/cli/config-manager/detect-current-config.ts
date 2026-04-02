import { existsSync, readFileSync } from "node:fs"
import { parseJsonc, LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../shared"
import type { DetectedConfig } from "../types"
import { getOmoConfigPath } from "./config-context"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"

function detectProvidersFromOmoConfig(): {
  hasOpenAI: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasOpencodeGo: boolean
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
  minimaxModelVariant: "standard" | "highspeed"
} {
  const omoConfigPath = getOmoConfigPath()
  if (!existsSync(omoConfigPath)) {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      minimaxModelVariant: "standard",
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
        hasMinimaxCnCodingPlan: false,
        hasMinimaxCodingPlan: false,
        minimaxModelVariant: "standard",
      }
    }

    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')
    const hasOpencodeGo = configStr.includes('"opencode-go/')
    const hasMinimaxCnCodingPlan = configStr.includes('"minimax-cn-coding-plan/')
    const hasMinimaxCodingPlan = configStr.includes('"minimax-coding-plan/')
    const minimaxModelVariant = configStr.includes('MiniMax-M2.5-highspeed') ? "highspeed" : "standard"

    return {
      hasOpenAI,
      hasOpencodeZen,
      hasZaiCodingPlan,
      hasKimiForCoding,
      hasOpencodeGo,
      hasMinimaxCnCodingPlan,
      hasMinimaxCodingPlan,
      minimaxModelVariant,
    }
  } catch {
    return {
      hasOpenAI: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
      hasMinimaxCnCodingPlan: false,
      hasMinimaxCodingPlan: false,
      minimaxModelVariant: "standard",
    }
  }
}

function isOurPlugin(plugin: string): boolean {
  return plugin === PLUGIN_NAME || plugin.startsWith(`${PLUGIN_NAME}@`) ||
         plugin === LEGACY_PLUGIN_NAME || plugin.startsWith(`${LEGACY_PLUGIN_NAME}@`)
}

export function detectCurrentConfig(): DetectedConfig {
  const result: DetectedConfig = {
    isInstalled: false,
    hasClaude: true,
    isMax20: true,
    hasOpenAI: true,
    hasGemini: false,
    hasCopilot: false,
    hasOpencodeZen: true,
    hasZaiCodingPlan: false,
    hasKimiForCoding: false,
    hasOpencodeGo: false,
    hasMinimaxCnCodingPlan: false,
    hasMinimaxCodingPlan: false,
    minimaxModelVariant: "standard",
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
  result.isInstalled = plugins.some(isOurPlugin)

  if (!result.isInstalled) {
    return result
  }

  const providers = openCodeConfig.provider as Record<string, unknown> | undefined
  result.hasGemini = providers ? "google" in providers : false

  const { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding, hasOpencodeGo, hasMinimaxCnCodingPlan, hasMinimaxCodingPlan, minimaxModelVariant } =
    detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding
  result.hasOpencodeGo = hasOpencodeGo
  result.hasMinimaxCnCodingPlan = hasMinimaxCnCodingPlan
  result.hasMinimaxCodingPlan = hasMinimaxCodingPlan
  result.minimaxModelVariant = minimaxModelVariant

  return result
}
