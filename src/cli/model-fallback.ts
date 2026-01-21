import type { InstallConfig } from "./types"

type NativeProvider = "claude" | "openai" | "gemini"

type ModelCapability =
  | "unspecified-high"
  | "unspecified-low"
  | "quick"
  | "ultrabrain"
  | "visual-engineering"
  | "artistry"
  | "writing"
  | "glm"

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

interface NativeFallbackEntry {
  provider: NativeProvider
  model: string
}

const NATIVE_FALLBACK_CHAINS: Record<ModelCapability, NativeFallbackEntry[]> = {
  "unspecified-high": [
    { provider: "claude", model: "anthropic/claude-opus-4-5" },
    { provider: "openai", model: "openai/gpt-5.2" },
    { provider: "gemini", model: "google/gemini-3-pro-preview" },
  ],
  "unspecified-low": [
    { provider: "claude", model: "anthropic/claude-sonnet-4-5" },
    { provider: "openai", model: "openai/gpt-5.2" },
    { provider: "gemini", model: "google/gemini-3-flash-preview" },
  ],
  quick: [
    { provider: "claude", model: "anthropic/claude-haiku-4-5" },
    { provider: "openai", model: "openai/gpt-5.1-codex-mini" },
    { provider: "gemini", model: "google/gemini-3-flash-preview" },
  ],
  ultrabrain: [
    { provider: "openai", model: "openai/gpt-5.2-codex" },
    { provider: "claude", model: "anthropic/claude-opus-4-5" },
    { provider: "gemini", model: "google/gemini-3-pro-preview" },
  ],
  "visual-engineering": [
    { provider: "gemini", model: "google/gemini-3-pro-preview" },
    { provider: "openai", model: "openai/gpt-5.2" },
    { provider: "claude", model: "anthropic/claude-sonnet-4-5" },
  ],
  artistry: [
    { provider: "gemini", model: "google/gemini-3-pro-preview" },
    { provider: "openai", model: "openai/gpt-5.2" },
    { provider: "claude", model: "anthropic/claude-opus-4-5" },
  ],
  writing: [
    { provider: "gemini", model: "google/gemini-3-flash-preview" },
    { provider: "openai", model: "openai/gpt-5.2" },
    { provider: "claude", model: "anthropic/claude-sonnet-4-5" },
  ],
  glm: [],
}

const OPENCODE_ZEN_MODELS: Record<ModelCapability, string> = {
  "unspecified-high": "opencode/claude-opus-4-5",
  "unspecified-low": "opencode/claude-sonnet-4-5",
  quick: "opencode/claude-haiku-4-5",
  ultrabrain: "opencode/gpt-5.2-codex",
  "visual-engineering": "opencode/gemini-3-pro",
  artistry: "opencode/gemini-3-pro",
  writing: "opencode/gemini-3-flash",
  glm: "opencode/glm-4.7-free",
}

const GITHUB_COPILOT_MODELS: Record<ModelCapability, string> = {
  "unspecified-high": "github-copilot/claude-opus-4.5",
  "unspecified-low": "github-copilot/claude-sonnet-4.5",
  quick: "github-copilot/claude-haiku-4.5",
  ultrabrain: "github-copilot/gpt-5.2-codex",
  "visual-engineering": "github-copilot/gemini-3-pro-preview",
  artistry: "github-copilot/gemini-3-pro-preview",
  writing: "github-copilot/gemini-3-flash-preview",
  glm: "github-copilot/gpt-5.2",
}

const ZAI_MODEL = "zai-coding-plan/glm-4.7"

interface AgentRequirement {
  capability: ModelCapability
  variant?: string
}

const AGENT_REQUIREMENTS: Record<string, AgentRequirement> = {
  Sisyphus: { capability: "unspecified-high" },
  oracle: { capability: "ultrabrain", variant: "high" },
  librarian: { capability: "glm" },
  explore: { capability: "quick" },
  "multimodal-looker": { capability: "visual-engineering" },
  "Prometheus (Planner)": { capability: "unspecified-high" },
  "Metis (Plan Consultant)": { capability: "unspecified-high" },
  "Momus (Plan Reviewer)": { capability: "ultrabrain", variant: "medium" },
  Atlas: { capability: "unspecified-high" },
}

interface CategoryRequirement {
  capability: ModelCapability
  variant?: string
}

const CATEGORY_REQUIREMENTS: Record<string, CategoryRequirement> = {
  "visual-engineering": { capability: "visual-engineering" },
  ultrabrain: { capability: "ultrabrain" },
  artistry: { capability: "artistry", variant: "max" },
  quick: { capability: "quick" },
  "unspecified-low": { capability: "unspecified-low" },
  "unspecified-high": { capability: "unspecified-high" },
  writing: { capability: "writing" },
}

const ULTIMATE_FALLBACK = "opencode/glm-4.7-free"
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

function resolveModel(capability: ModelCapability, avail: ProviderAvailability): string {
  const nativeChain = NATIVE_FALLBACK_CHAINS[capability]
  for (const entry of nativeChain) {
    if (avail.native[entry.provider]) {
      return entry.model
    }
  }

  if (avail.opencodeZen) {
    return OPENCODE_ZEN_MODELS[capability]
  }

  if (avail.copilot) {
    return GITHUB_COPILOT_MODELS[capability]
  }

  if (avail.zai) {
    return ZAI_MODEL
  }

  return ULTIMATE_FALLBACK
}

function resolveClaudeCapability(avail: ProviderAvailability): ModelCapability {
  return avail.isMaxPlan ? "unspecified-high" : "unspecified-low"
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
        Object.keys(AGENT_REQUIREMENTS).map((role) => [role, { model: ULTIMATE_FALLBACK }])
      ),
      categories: Object.fromEntries(
        Object.keys(CATEGORY_REQUIREMENTS).map((cat) => [cat, { model: ULTIMATE_FALLBACK }])
      ),
    }
  }

  const agents: Record<string, AgentConfig> = {}
  const categories: Record<string, CategoryConfig> = {}

  const claudeCapability = resolveClaudeCapability(avail)

  for (const [role, req] of Object.entries(AGENT_REQUIREMENTS)) {
    if (role === "librarian" && avail.zai) {
      agents[role] = { model: ZAI_MODEL }
    } else if (role === "explore") {
      if (avail.native.claude && avail.isMaxPlan) {
        agents[role] = { model: "anthropic/claude-haiku-4-5" }
      } else {
        agents[role] = { model: "opencode/grok-code" }
      }
    } else {
      const capability = req.capability === "unspecified-high" ? claudeCapability : req.capability
      const model = resolveModel(capability, avail)
      agents[role] = req.variant ? { model, variant: req.variant } : { model }
    }
  }

  for (const [cat, req] of Object.entries(CATEGORY_REQUIREMENTS)) {
    const capability = req.capability === "unspecified-high" ? claudeCapability : req.capability
    const model = resolveModel(capability, avail)
    categories[cat] = req.variant ? { model, variant: req.variant } : { model }
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
