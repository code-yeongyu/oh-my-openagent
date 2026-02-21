import { existsSync, readFileSync } from "node:fs"
import { parseJsonc } from "../../shared"
import type { DetectedConfig } from "../types"
import { getOmoConfigPath } from "./config-context"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError } from "./parse-opencode-config-file"

function detectProvidersFromOmoConfig(): {
  hasOpenAI: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
} {
  const omoConfigPath = getOmoConfigPath()
  if (!existsSync(omoConfigPath)) {
    return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }

  try {
    const content = readFileSync(omoConfigPath, "utf-8")
    const omoConfig = parseJsonc<Record<string, unknown>>(content)
    if (!omoConfig || typeof omoConfig !== "object") {
      return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
    }

    const configStr = JSON.stringify(omoConfig)
    const hasOpenAI = configStr.includes('"openai/')
    const hasOpencodeZen = configStr.includes('"opencode/')
    const hasZaiCodingPlan = configStr.includes('"zai-coding-plan/')
    const hasKimiForCoding = configStr.includes('"kimi-for-coding/')

    return { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding }
  } catch {
    return { hasOpenAI: true, hasOpencodeZen: true, hasZaiCodingPlan: false, hasKimiForCoding: false }
  }
}

function detectLocalProvidersFromOpenCodeConfig(openCodeConfig: Record<string, unknown>): {
  hasLmstudio: boolean
  lmstudioUrl?: string
  hasOllama: boolean
  ollamaUrl?: string
  hasVllm: boolean
  vllmUrl?: string
} {
  const providers = openCodeConfig.provider
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return {
      hasLmstudio: false,
      hasOllama: false,
      hasVllm: false,
    }
  }

  const readUrl = (providerName: string): string | undefined => {
    const providerValue = (providers as Record<string, unknown>)[providerName]
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
      return undefined
    }
    const url = (providerValue as Record<string, unknown>).url
    return typeof url === "string" && url.length > 0 ? url : undefined
  }

  const lmstudioUrl = readUrl("lmstudio")
  const ollamaUrl = readUrl("ollama")
  const vllmUrl = readUrl("vllm")

  return {
    hasLmstudio: lmstudioUrl !== undefined,
    lmstudioUrl,
    hasOllama: ollamaUrl !== undefined,
    ollamaUrl,
    hasVllm: vllmUrl !== undefined,
    vllmUrl,
  }
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
    hasLmstudio: false,
    hasOllama: false,
    hasVllm: false,
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
  result.isInstalled = plugins.some((p) => p.startsWith("oh-my-opencode"))

  if (!result.isInstalled) {
    return result
  }

  result.hasGemini = plugins.some((p) => p.startsWith("opencode-antigravity-auth"))

  const { hasOpenAI, hasOpencodeZen, hasZaiCodingPlan, hasKimiForCoding } = detectProvidersFromOmoConfig()
  result.hasOpenAI = hasOpenAI
  result.hasOpencodeZen = hasOpencodeZen
  result.hasZaiCodingPlan = hasZaiCodingPlan
  result.hasKimiForCoding = hasKimiForCoding

  const localProviders = detectLocalProvidersFromOpenCodeConfig(openCodeConfig as Record<string, unknown>)
  result.hasLmstudio = localProviders.hasLmstudio
  result.lmstudioUrl = localProviders.lmstudioUrl
  result.hasOllama = localProviders.hasOllama
  result.ollamaUrl = localProviders.ollamaUrl
  result.hasVllm = localProviders.hasVllm
  result.vllmUrl = localProviders.vllmUrl

  return result
}
