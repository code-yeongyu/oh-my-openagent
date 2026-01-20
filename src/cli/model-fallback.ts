import type { InstallConfig } from "./types"

type ProviderTier = "native" | "github-copilot" | "opencode" | "zai-coding-plan"

type ModelCapability =
  | "opus-level"
  | "sonnet-level"
  | "haiku-level"
  | "reasoning"
  | "codex"
  | "visual"
  | "fast"
  | "glm"

interface ProviderAvailability {
  native: {
    claude: boolean
    openai: boolean
    gemini: boolean
  }
  copilot: boolean
  opencode: boolean
  zai: boolean
}

export interface GeneratedOmoConfig {
  $schema: string
  agents?: Record<string, { model: string }>
  categories?: Record<string, { model: string }>
  [key: string]: unknown
}

const MODEL_CATALOG: Record<ProviderTier, Partial<Record<ModelCapability, string>>> = {
  native: {
    "opus-level": "anthropic/claude-opus-4-5",
    "sonnet-level": "anthropic/claude-sonnet-4-5",
    "haiku-level": "anthropic/claude-haiku-4-5",
    reasoning: "openai/gpt-5.2",
    codex: "openai/gpt-5.2-codex",
    visual: "google/gemini-3-pro-preview",
    fast: "google/gemini-3-flash-preview",
  },
  "github-copilot": {
    "opus-level": "github-copilot/claude-opus-4.5",
    "sonnet-level": "github-copilot/claude-sonnet-4.5",
    "haiku-level": "github-copilot/claude-haiku-4.5",
    reasoning: "github-copilot/gpt-5.2",
    codex: "github-copilot/gpt-5.2-codex",
    visual: "github-copilot/gemini-3-pro-preview",
    fast: "github-copilot/grok-code-fast-1",
  },
  opencode: {
    "opus-level": "opencode/claude-opus-4-5",
    "sonnet-level": "opencode/claude-sonnet-4-5",
    "haiku-level": "opencode/claude-haiku-4-5",
    reasoning: "opencode/gpt-5.2",
    codex: "opencode/gpt-5.2-codex",
    visual: "opencode/gemini-3-pro",
    fast: "opencode/grok-code",
    glm: "opencode/glm-4.7-free",
  },
  "zai-coding-plan": {
    "opus-level": "zai-coding-plan/glm-4.7",
    "sonnet-level": "zai-coding-plan/glm-4.7",
    "haiku-level": "zai-coding-plan/glm-4.7-flash",
    reasoning: "zai-coding-plan/glm-4.7",
    codex: "zai-coding-plan/glm-4.7",
    visual: "zai-coding-plan/glm-4.7",
    fast: "zai-coding-plan/glm-4.7-flash",
    glm: "zai-coding-plan/glm-4.7",
  },
}

const AGENT_REQUIREMENTS: Record<string, ModelCapability> = {
  Sisyphus: "opus-level",
  oracle: "reasoning",
  librarian: "glm",
  explore: "fast",
  "multimodal-looker": "visual",
  "Prometheus (Planner)": "opus-level",
  "Metis (Plan Consultant)": "sonnet-level",
  "Momus (Plan Reviewer)": "sonnet-level",
  Atlas: "opus-level",
}

const CATEGORY_REQUIREMENTS: Record<string, ModelCapability> = {
  "visual-engineering": "visual",
  ultrabrain: "codex",
  artistry: "visual",
  quick: "haiku-level",
  "unspecified-low": "sonnet-level",
  "unspecified-high": "opus-level",
  writing: "fast",
}

const ULTIMATE_FALLBACK = "opencode/glm-4.7-free"
const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"

function toProviderAvailability(config: InstallConfig): ProviderAvailability {
  return {
    native: {
      claude: config.hasClaude,
      openai: config.hasClaude,
      gemini: config.hasGemini,
    },
    copilot: config.hasCopilot,
    opencode: config.hasOpencodeZen,
    zai: config.hasZaiCodingPlan,
  }
}

function getProviderPriority(avail: ProviderAvailability): ProviderTier[] {
  const tiers: ProviderTier[] = []

  if (avail.native.claude || avail.native.openai || avail.native.gemini) {
    tiers.push("native")
  }
  if (avail.copilot) tiers.push("github-copilot")
  if (avail.opencode) tiers.push("opencode")
  if (avail.zai) tiers.push("zai-coding-plan")

  return tiers
}

function hasCapability(
  tier: ProviderTier,
  capability: ModelCapability,
  avail: ProviderAvailability
): boolean {
  if (tier === "native") {
    switch (capability) {
      case "opus-level":
      case "sonnet-level":
      case "haiku-level":
        return avail.native.claude
      case "reasoning":
      case "codex":
        return avail.native.openai || avail.native.claude
      case "visual":
      case "fast":
        return avail.native.gemini
      case "glm":
        return false
    }
  }
  return true
}

function resolveModel(capability: ModelCapability, avail: ProviderAvailability): string {
  const tiers = getProviderPriority(avail)

  for (const tier of tiers) {
    if (hasCapability(tier, capability, avail)) {
      const model = MODEL_CATALOG[tier][capability]
      if (model) return model
    }
  }

  return ULTIMATE_FALLBACK
}

export function generateModelConfig(config: InstallConfig): GeneratedOmoConfig {
  const avail = toProviderAvailability(config)
  const hasAnyProvider =
    avail.native.claude ||
    avail.native.openai ||
    avail.native.gemini ||
    avail.copilot ||
    avail.opencode ||
    avail.zai

  if (!hasAnyProvider) {
    return {
      $schema: SCHEMA_URL,
      agents: Object.fromEntries(
        Object.keys(AGENT_REQUIREMENTS).map((role) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CATEGORY_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, { model: string }> = {}
  const categories: Record<string, { model: string }> = {}

  for (const [role, capability] of Object.entries(AGENT_REQUIREMENTS)) {
    if (role === "librarian" && avail.zai) {
      agents[role] = { model: "zai-coding-plan/glm-4.7" }
    } else {
      agents[role] = { model: resolveModel(capability, avail) }
    }
  }

  for (const [cat, capability] of Object.entries(CATEGORY_REQUIREMENTS)) {
    categories[cat] = { model: resolveModel(capability, avail) }
  }

  return {
    $schema: SCHEMA_URL,
    agents,
    categories,
  }
}
