import {
  CLI_AGENT_MODEL_REQUIREMENTS,
  CLI_CATEGORY_MODEL_REQUIREMENTS,
} from "./model-fallback-requirements"
import type { InstallConfig } from "./types"

import type { AgentConfig, CategoryConfig, GeneratedOmoConfig } from "./model-fallback-types"
import { applyOpenAiOnlyModelCatalog, isOpenAiOnlyAvailability } from "./openai-only-model-catalog"
import { toProviderAvailability } from "./provider-availability"
import {
	getSisyphusFallbackChain,
	isAnyFallbackEntryAvailable,
	isRequiredModelAvailable,
	isRequiredProviderAvailable,
	resolveModelFromChain,
} from "./fallback-chain-resolution"

export type { GeneratedOmoConfig } from "./model-fallback-types"

const ZAI_MODEL = "zai-coding-plan/glm-4.7"
const MINIMAX_STANDARD_MODEL_ID = "MiniMax-M2.5"
const MINIMAX_HIGHSPEED_MODEL_ID = "MiniMax-M2.5-highspeed"

const ULTIMATE_FALLBACK = "opencode/gpt-5-nano"
const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"

function getMiniMaxModelId(config: InstallConfig): string {
  return config.minimaxModelVariant === "highspeed"
    ? MINIMAX_HIGHSPEED_MODEL_ID
    : MINIMAX_STANDARD_MODEL_ID
}

function getMiniMaxModel(providerID: "minimax-cn-coding-plan" | "minimax-coding-plan", config: InstallConfig): string {
  return `${providerID}/${getMiniMaxModelId(config)}`
}

function applyMiniMaxVariant(model: string, config: InstallConfig): string {
  if (!model.includes("minimax-cn-coding-plan/") && !model.includes("minimax-coding-plan/")) {
    return model
  }

  return model.replace(/MiniMax-M2\.5(-highspeed)?$/, getMiniMaxModelId(config))
}

export function generateModelConfig(config: InstallConfig): GeneratedOmoConfig {
  const avail = toProviderAvailability(config)
  const hasAnyProvider =
    avail.native.claude ||
    avail.native.openai ||
    avail.native.gemini ||
    avail.opencodeZen ||
    avail.copilot ||
    avail.zai ||
    avail.kimiForCoding ||
    avail.opencodeGo ||
    avail.minimaxCnCodingPlan ||
    avail.minimaxCodingPlan
  if (!hasAnyProvider) {
    return {
      $schema: SCHEMA_URL,
      agents: Object.fromEntries(
        Object.entries(CLI_AGENT_MODEL_REQUIREMENTS)
          .filter(([role, req]) => !(role === "sisyphus" && req.requiresAnyModel))
          .map(([role]) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CLI_CATEGORY_MODEL_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, AgentConfig> = {}
  const categories: Record<string, CategoryConfig> = {}

  for (const [role, req] of Object.entries(CLI_AGENT_MODEL_REQUIREMENTS)) {
    if (role === "librarian") {
      if (avail.opencodeGo) {
        agents[role] = { model: "opencode-go/minimax-m2.7" }
      } else if (avail.zai) {
        agents[role] = { model: ZAI_MODEL }
      }
      continue
    }

    if (role === "explore") {
      if (avail.native.claude) {
        agents[role] = { model: "anthropic/claude-haiku-4-5" }
      } else if (avail.opencodeZen) {
        agents[role] = { model: "opencode/claude-haiku-4-5" }
      } else if (avail.opencodeGo) {
        agents[role] = { model: "opencode-go/minimax-m2.7" }
      } else if (avail.copilot) {
        agents[role] = { model: "github-copilot/gpt-5-mini" }
      } else if (avail.minimaxCodingPlan) {
        agents[role] = { model: getMiniMaxModel("minimax-coding-plan", config) }
      } else if (avail.minimaxCnCodingPlan) {
        agents[role] = { model: getMiniMaxModel("minimax-cn-coding-plan", config) }
      } else {
        agents[role] = { model: "opencode/gpt-5-nano" }
      }
      continue
    }

    if (role === "sisyphus") {
      const fallbackChain = getSisyphusFallbackChain()
      if (req.requiresAnyModel && !isAnyFallbackEntryAvailable(fallbackChain, avail)) {
        continue
      }
      const resolved = resolveModelFromChain(fallbackChain, avail)
      if (resolved) {
        const variant = resolved.variant ?? req.variant
        const model = applyMiniMaxVariant(resolved.model, config)
        agents[role] = variant ? { model, variant } : { model }
      }
      continue
    }

    if (req.requiresModel && !isRequiredModelAvailable(req.requiresModel, req.fallbackChain, avail)) {
      continue
    }
    if (req.requiresProvider && !isRequiredProviderAvailable(req.requiresProvider, avail)) {
      continue
    }

    const resolved = resolveModelFromChain(req.fallbackChain, avail)
    if (resolved) {
      const variant = resolved.variant ?? req.variant
      const model = applyMiniMaxVariant(resolved.model, config)
      agents[role] = variant ? { model, variant } : { model }
    } else {
      agents[role] = { model: ULTIMATE_FALLBACK }
    }
  }

  for (const [cat, req] of Object.entries(CLI_CATEGORY_MODEL_REQUIREMENTS)) {
    // Special case: unspecified-high downgrades to unspecified-low when not isMaxPlan
    const fallbackChain =
      cat === "unspecified-high" && !avail.isMaxPlan
        ? CLI_CATEGORY_MODEL_REQUIREMENTS["unspecified-low"].fallbackChain
        : req.fallbackChain

    if (req.requiresModel && !isRequiredModelAvailable(req.requiresModel, req.fallbackChain, avail)) {
      continue
    }
    if (req.requiresProvider && !isRequiredProviderAvailable(req.requiresProvider, avail)) {
      continue
    }

    const resolved = resolveModelFromChain(fallbackChain, avail)
    if (resolved) {
      const variant = resolved.variant ?? req.variant
      const model = applyMiniMaxVariant(resolved.model, config)
      categories[cat] = variant ? { model, variant } : { model }
    } else {
      categories[cat] = { model: ULTIMATE_FALLBACK }
    }
  }

  const generatedConfig: GeneratedOmoConfig = {
    $schema: SCHEMA_URL,
    agents,
    categories,
  }

  return isOpenAiOnlyAvailability(avail)
    ? applyOpenAiOnlyModelCatalog(generatedConfig)
    : generatedConfig
}

export function shouldShowChatGPTOnlyWarning(config: InstallConfig): boolean {
  return !config.hasClaude && !config.hasGemini && config.hasOpenAI
}
