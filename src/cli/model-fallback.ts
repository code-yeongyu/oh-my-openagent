import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
} from "../shared/model-requirements"
import type { InstallConfig } from "./types"

interface ProviderAvailability {
  native: {
    claude: boolean
    openai: boolean
    gemini: boolean
  }
  opencodeZen: boolean
  copilot: boolean
  zai: boolean
  isMaxPlan: boolean
}

interface AgentConfig {
  model: string
  variant?: string
}

interface CategoryConfig {
  model: string
  variant?: string
}

export interface GeneratedOmoConfig {
  $schema: string
  agents?: Record<string, AgentConfig>
  categories?: Record<string, CategoryConfig>
  [key: string]: unknown
}

const ZAI_MODEL = "zai-coding-plan/glm-4.7"

const ULTIMATE_FALLBACK = "opencode/big-pickle"
const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"

function toProviderAvailability(config: InstallConfig): ProviderAvailability {
  return {
    native: {
      claude: config.hasClaude,
      openai: config.hasOpenAI,
      gemini: config.hasGemini,
    },
    opencodeZen: config.hasOpencodeZen,
    copilot: config.hasCopilot,
    zai: config.hasZaiCodingPlan,
    isMaxPlan: config.isMax20,
  }
}

function isProviderAvailable(provider: string, avail: ProviderAvailability): boolean {
  const mapping: Record<string, boolean> = {
    anthropic: avail.native.claude,
    openai: avail.native.openai,
    google: avail.native.gemini,
    "github-copilot": avail.copilot,
    opencode: avail.opencodeZen,
    "zai-coding-plan": avail.zai,
  }
  return mapping[provider] ?? false
}

function transformModelForProvider(provider: string, model: string): string {
  if (provider === "github-copilot") {
    return model
      .replace("claude-opus-4-5", "claude-opus-4.5")
      .replace("claude-sonnet-4-5", "claude-sonnet-4.5")
      .replace("claude-haiku-4-5", "claude-haiku-4.5")
      .replace("claude-sonnet-4", "claude-sonnet-4")
  }
  return model
}

function resolveModelFromChain(
  fallbackChain: FallbackEntry[],
  avail: ProviderAvailability
): { model: string; variant?: string } | null {
  for (const entry of fallbackChain) {
    for (const provider of entry.providers) {
      if (isProviderAvailable(provider, avail)) {
        const transformedModel = transformModelForProvider(provider, entry.model)
        return {
          model: `${provider}/${transformedModel}`,
          variant: entry.variant,
        }
      }
    }
  }
  return null
}

function getSisyphusFallbackChain(isMaxPlan: boolean): FallbackEntry[] {
  // Sisyphus uses opus when isMaxPlan, sonnet otherwise
  if (isMaxPlan) {
    return AGENT_MODEL_REQUIREMENTS.sisyphus.fallbackChain
  }
  // For non-max plan, use sonnet instead of opus
  return [
    { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-5" },
    { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
    { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
  ]
}

export function generateModelConfig(config: InstallConfig): GeneratedOmoConfig {
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
        Object.keys(AGENT_MODEL_REQUIREMENTS).map((role) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CATEGORY_MODEL_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, AgentConfig> = {}
  const categories: Record<string, CategoryConfig> = {}

  for (const [role, req] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
    // Special case: librarian always uses ZAI first if available
    if (role === "librarian" && avail.zai) {
      agents[role] = { model: ZAI_MODEL }
      continue
    }

    // Special case: explore uses Claude haiku → OpenCode gpt-5-nano
    if (role === "explore") {
      if (avail.native.claude) {
        agents[role] = { model: "anthropic/claude-haiku-4-5" }
      } else if (avail.opencodeZen) {
        agents[role] = { model: "opencode/claude-haiku-4-5" }
      } else {
        agents[role] = { model: "opencode/gpt-5-nano" }
      }
      continue
    }

    // Special case: Sisyphus uses different fallbackChain based on isMaxPlan
    const fallbackChain =
      role === "sisyphus" ? getSisyphusFallbackChain(avail.isMaxPlan) : req.fallbackChain

    const resolved = resolveModelFromChain(fallbackChain, avail)
    if (resolved) {
      const variant = resolved.variant ?? req.variant
      agents[role] = variant ? { model: resolved.model, variant } : { model: resolved.model }
    } else {
      agents[role] = { model: ULTIMATE_FALLBACK }
    }
  }

  for (const [cat, req] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
    // Special case: unspecified-high downgrades to unspecified-low when not isMaxPlan
    const fallbackChain =
      cat === "unspecified-high" && !avail.isMaxPlan
        ? CATEGORY_MODEL_REQUIREMENTS["unspecified-low"].fallbackChain
        : req.fallbackChain

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

export function shouldShowChatGPTOnlyWarning(config: InstallConfig): boolean {
  return !config.hasClaude && !config.hasGemini && config.hasOpenAI
}
