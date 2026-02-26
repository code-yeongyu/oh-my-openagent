import {
  CLI_AGENT_MODEL_REQUIREMENTS,
  CLI_CATEGORY_MODEL_REQUIREMENTS,
} from "./model-fallback-requirements"
import type { InstallConfig } from "./types"

import type { AgentConfig, CategoryConfig, GeneratedOmoConfig } from "./model-fallback-types"
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

const ULTIMATE_FALLBACK = "opencode/glm-4.7-free"
const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"

function resolveLocalTargetModel(
	target: "explore" | "librarian" | "atlas" | "multimodal-looker" | "quick" | "unspecified-low",
	availability: ReturnType<typeof toProviderAvailability>
): { model: string; variant?: string } | null {
	return resolveModelFromChain(
		[{ providers: ["lmstudio", "ollama", "vllm"], model: `local:${target}` }],
		availability
	)
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
    avail.lmstudio ||
    avail.ollama ||
    avail.vllm

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
    if (role === "librarian" && avail.zai) {
      agents[role] = { model: ZAI_MODEL }
      continue
    }

    if (role === "explore") {
      if (avail.native.claude) {
        agents[role] = { model: "anthropic/claude-haiku-4-5" }
      } else if (avail.opencodeZen) {
        agents[role] = { model: "opencode/claude-haiku-4-5" }
      } else if (avail.copilot) {
        agents[role] = { model: "github-copilot/gpt-5-mini" }
      } else {
        const resolvedLocal = resolveLocalTargetModel("explore", avail)
        if (resolvedLocal) {
          agents[role] = { model: resolvedLocal.model }
        } else {
          agents[role] = { model: "opencode/gpt-5-nano" }
        }
      }
      continue
    }

    if (role === "librarian") {
      const resolved = resolveModelFromChain(req.fallbackChain, avail)
      const localLibrarian = resolveLocalTargetModel("librarian", avail)

      if (resolved?.model === "opencode/glm-4.7-free" && localLibrarian) {
        agents[role] = { model: localLibrarian.model }
      } else if (resolved) {
        const variant = resolved.variant ?? req.variant
        agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
      } else {
        agents[role] = { model: ULTIMATE_FALLBACK }
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
        agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
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
      const localMultimodal = role === "multimodal-looker" ? resolveLocalTargetModel("multimodal-looker", avail) : null
      if (resolved.model === "opencode/gpt-5-nano" && localMultimodal) {
        agents[role] = { model: localMultimodal.model }
        continue
      }

      const variant = resolved.variant ?? req.variant
      agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
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
      const localQuick = cat === "quick" ? resolveLocalTargetModel("quick", avail) : null
      if (resolved.model === "opencode/gpt-5-nano" && localQuick) {
        categories[cat] = { model: localQuick.model }
        continue
      }

      const variant = resolved.variant ?? req.variant
      categories[cat] = variant ? { model: resolved.model, variant } : { model: resolved.model }
    } else {
      categories[cat] = { model: ULTIMATE_FALLBACK }
    }
  }

  return {
    $schema: SCHEMA_URL,
    agents,
    categories,
  }
}

export function shouldShowChatGPTOnlyWarning(config: InstallConfig): boolean {
  return !config.hasClaude && !config.hasGemini && config.hasOpenAI
}
