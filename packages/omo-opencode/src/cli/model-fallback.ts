import {
  CLI_AGENT_MODEL_REQUIREMENTS,
  CLI_CATEGORY_MODEL_REQUIREMENTS,
} from "./model-fallback-requirements"
import type { FallbackModelObject } from "../config/schema/fallback-models"
import type { FallbackEntry } from "../shared/model-requirements"
import { getModelCapabilities, resolveCompatibleModelSettings } from "@oh-my-opencode/model-core"
import type { InstallConfig } from "./types"

import type { AgentConfig, CategoryConfig, GeneratedOmoConfig } from "./model-fallback-types"
import { applyOpenAiOnlyModelCatalog, isOpenAiOnlyAvailability } from "./openai-only-model-catalog"
import { isProviderAvailable, toProviderAvailability } from "./provider-availability"
import {
	getSisyphusFallbackChain,
	isAnyFallbackEntryAvailable,
	isRequiredModelAvailable,
	isRequiredProviderAvailable,
	resolveModelFromChain,
} from "./fallback-chain-resolution"
import { transformModelForProvider } from "./provider-model-id-transform"

export type { GeneratedOmoConfig } from "./model-fallback-types"

export const ULTIMATE_FALLBACK = "opencode/gpt-5-nano"
const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"

type CompatibleFallbackSettings = {
  variant?: string
  reasoningEffort?: FallbackModelObject["reasoningEffort"]
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: FallbackModelObject["thinking"]
}

function resolveCompatibleFallbackSettings(
  providerID: string,
  modelID: string,
  desired: CompatibleFallbackSettings,
): CompatibleFallbackSettings {
  const compatibility = resolveCompatibleModelSettings({
    providerID,
    modelID,
    desired: {
      variant: desired.variant,
      reasoningEffort: desired.reasoningEffort,
      temperature: desired.temperature,
      topP: desired.top_p,
      maxTokens: desired.maxTokens,
      thinking: desired.thinking,
    },
    capabilities: getModelCapabilities({ providerID, modelID }),
  })

  return {
    ...(compatibility.variant ? { variant: compatibility.variant } : {}),
    ...(compatibility.reasoningEffort ? { reasoningEffort: compatibility.reasoningEffort as FallbackModelObject["reasoningEffort"] } : {}),
    ...(compatibility.temperature !== undefined ? { temperature: compatibility.temperature } : {}),
    ...(compatibility.topP !== undefined ? { top_p: compatibility.topP } : {}),
    ...(compatibility.maxTokens !== undefined ? { maxTokens: compatibility.maxTokens } : {}),
    ...(compatibility.thinking !== undefined ? { thinking: compatibility.thinking as FallbackModelObject["thinking"] } : {}),
  }
}

function toCompatibleModelConfig(model: string, desired: Pick<CompatibleFallbackSettings, "variant">): AgentConfig {
  const slashIndex = model.indexOf("/")
  if (slashIndex === -1) {
    return desired.variant ? { model, variant: desired.variant } : { model }
  }

  const providerID = model.slice(0, slashIndex)
  const modelID = model.slice(slashIndex + 1)
  const compatible = resolveCompatibleFallbackSettings(providerID, modelID, desired)
  return compatible.variant ? { model, variant: compatible.variant } : { model }
}

function toFallbackModelObject(entry: FallbackEntry, provider: string): FallbackModelObject {
  const modelID = transformModelForProvider(provider, entry.model)
  const compatible = resolveCompatibleFallbackSettings(provider, modelID, {
    variant: entry.variant,
    reasoningEffort: entry.reasoningEffort as FallbackModelObject["reasoningEffort"] | undefined,
    temperature: entry.temperature,
    top_p: entry.top_p,
    maxTokens: entry.maxTokens,
    thinking: entry.thinking,
  })

  return {
    model: `${provider}/${modelID}`,
    ...compatible,
  }
}

function collectAvailableFallbacks(
  fallbackChain: FallbackEntry[],
  availability: ReturnType<typeof toProviderAvailability>,
): FallbackModelObject[] {
  const expandedFallbacks = fallbackChain.flatMap((entry) =>
    entry.providers
      .filter((provider: string) => isProviderAvailable(provider, availability))
      .map((provider: string) => toFallbackModelObject(entry, provider))
  )
  return expandedFallbacks.filter((entry, index, allEntries) =>
    allEntries.findIndex((candidate) =>
      candidate.model === entry.model &&
      candidate.variant === entry.variant
    ) === index
  )
}

function attachFallbackModels<T extends AgentConfig | CategoryConfig>(
  config: T,
  fallbackChain: FallbackEntry[],
  availability: ReturnType<typeof toProviderAvailability>,
): T {
  const uniqueFallbacks = collectAvailableFallbacks(fallbackChain, availability)
  const primaryIndex = uniqueFallbacks.findIndex((entry) => entry.model === config.model)
  if (primaryIndex === -1) {
    return config
  }

  const fallbackModels = uniqueFallbacks.slice(primaryIndex + 1)
  if (fallbackModels.length === 0) {
    return config
  }

  return {
    ...config,
    fallback_models: fallbackModels,
  }
}

function attachAllFallbackModels<T extends AgentConfig | CategoryConfig>(
  config: T,
  fallbackChain: FallbackEntry[],
  availability: ReturnType<typeof toProviderAvailability>,
): T {
  const uniqueFallbacks = collectAvailableFallbacks(fallbackChain, availability)
  const fallbackModels = uniqueFallbacks.filter((entry) => entry.model !== config.model)
  if (fallbackModels.length === 0) {
    return config
  }

  return {
    ...config,
    fallback_models: fallbackModels,
  }
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
    avail.bailianCodingPlan ||
    avail.minimaxCnCodingPlan ||
    avail.minimaxCodingPlan ||
    avail.vercelAiGateway
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
      const resolved = resolveModelFromChain(req.fallbackChain, avail)
      if (resolved) {
        const agentConfig = toCompatibleModelConfig(resolved.model, { variant: resolved.variant })
        agents[role] = attachFallbackModels(agentConfig, req.fallbackChain, avail)
      }
      continue
    }

    if (role === "explore") {
      let agentConfig: AgentConfig
      if (avail.native.openai) {
        agentConfig = { model: "openai/gpt-5.4-mini-fast" }
      } else if (avail.native.claude) {
        agentConfig = { model: "anthropic/claude-haiku-4-5" }
      } else if (avail.opencodeZen) {
        agentConfig = { model: "opencode/gpt-5-nano" }
      } else if (avail.opencodeGo) {
        agentConfig = { model: "opencode-go/qwen3.5-plus" }
      } else if (avail.copilot) {
        agentConfig = { model: "github-copilot/gpt-5-mini" }
      } else {
        const resolved = resolveModelFromChain(req.fallbackChain, avail)
        if (resolved) {
          const variant = resolved.variant ?? req.variant
          agentConfig = toCompatibleModelConfig(resolved.model, { variant })
        } else {
          agentConfig = { model: "opencode/gpt-5-nano" }
        }
      }
      agents[role] = attachAllFallbackModels(agentConfig, req.fallbackChain, avail)
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
        const agentConfig = toCompatibleModelConfig(resolved.model, { variant })
        agents[role] = attachFallbackModels(agentConfig, fallbackChain, avail)
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
      const agentConfig = toCompatibleModelConfig(resolved.model, { variant })
      agents[role] = attachFallbackModels(agentConfig, req.fallbackChain, avail)
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
      const categoryConfig = toCompatibleModelConfig(resolved.model, { variant })
      categories[cat] = attachFallbackModels(categoryConfig, fallbackChain, avail)
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
  return isOpenAiOnlyAvailability(toProviderAvailability(config))
}
