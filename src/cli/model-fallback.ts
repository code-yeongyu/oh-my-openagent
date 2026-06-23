import {
	AGENT_MODEL_REQUIREMENTS,
	CATEGORY_MODEL_REQUIREMENTS,
} from "../shared/model-requirements"
import {
	getMorpheusFallbackChain,
	isAnyFallbackEntryAvailable,
	isRequiredModelAvailable,
	isRequiredProviderAvailable,
	resolveModelFromChain,
} from "./fallback-chain-resolution"

import type { AgentConfig, CategoryConfig, GeneratedMatrixxConfig } from "./model-fallback-types"
import { toProviderAvailability } from "./provider-availability"
import type { InstallConfig } from "./types"

export type { GeneratedMatrixxConfig } from "./model-fallback-types"

const ZAI_MODEL = "zai-coding-plan/glm-4.7"

const ULTIMATE_FALLBACK = "opencode/glm-4.7-free"
const SCHEMA_URL = "https://raw.githubusercontent.com/klpanagi/matrixx/dev/assets/matrixx.schema.json"



export function generateModelConfig(config: InstallConfig): GeneratedMatrixxConfig {
  const avail = toProviderAvailability(config)
  const hasAnyProvider =
    avail.native.claude ||
    avail.native.openai ||
    avail.native.gemini ||
    avail.opencodeZen ||
    avail.copilot ||
    avail.zai

  if (!hasAnyProvider) {
    return {
      $schema: SCHEMA_URL,
      agents: Object.fromEntries(
        Object.entries(AGENT_MODEL_REQUIREMENTS)
          .filter(([role, req]) => !(role === "morpheus" && req.requiresAnyModel))
          .map(([role]) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CATEGORY_MODEL_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, AgentConfig> = {}
  const categories: Record<string, CategoryConfig> = {}

  for (const [role, req] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
    if (role === "operator" && avail.zai) {
      agents[role] = { model: ZAI_MODEL }
      continue
    }

    if (role === "trinity") {
      if (avail.native.claude) {
        agents[role] = { model: "anthropic/claude-haiku-4-5" }
      } else if (avail.opencodeZen) {
        agents[role] = { model: "opencode/claude-haiku-4-5" }
      } else if (avail.copilot) {
        agents[role] = { model: "github-copilot/gpt-5-mini" }
      } else {
        agents[role] = { model: "opencode/gpt-5-nano" }
      }
      continue
    }

    if (role === "morpheus") {
      const fallbackChain = getMorpheusFallbackChain()
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
      const variant = resolved.variant ?? req.variant
      agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
    } else {
      agents[role] = { model: ULTIMATE_FALLBACK }
    }
  }

  for (const [cat, req] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
    // Special case: red-pill downgrades to blue-pill when not isMaxPlan
    const fallbackChain =
      cat === "red-pill" && !avail.isMaxPlan
        ? CATEGORY_MODEL_REQUIREMENTS["blue-pill"].fallbackChain
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

