import {
  isClaudeFable51Model,
  isClaudeFable5Model,
  isClaudeHaiku55Model,
  isClaudeOpus45Model,
  isClaudeOpus46Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isClaudeOpus55Model,
  isClaudeOpus5LegacyModel,
  isClaudeSonnet55Model,
  isDeepseekV41FlashModel,
  isDeepseekV4Flash0731Model,
  isDeepseekV4FlashModel,
  isDeepseekV4ProModel,
  isGeminiModel,
  isGlm52Model,
  isGlm53Model,
  isGlmModel,
  isGpt5Model,
  isGpt52Model,
  isGpt53CodexModel,
  isGpt54Model,
  isGpt55Model,
  isGpt56Model,
  isGpt6FamilyModel,
  isGptModel,
  isGrok45Model,
  isGrok46Model,
  isGrok47Model,
  isKimiK26Model,
  isKimiK2CodeModel,
  isKimiK28Model,
  isKimiK2Model,
  isKimiK3Model,
  isMiniMaxModel,
  isSWE2Model,
} from "@oh-my-opencode/model-core"
import type { VariantTable } from "./types"

type ModelMatcher = (modelID: string) => boolean

type ProviderAwareMatcher = (modelID: string, providerID?: string) => boolean

export type ResolveVariantInput = {
  readonly modelID?: string
  readonly providerID?: string
  readonly agentName?: string
  readonly variants: VariantTable
}

const PLANNER_AGENT_NAMES: ReadonlySet<string> = new Set(["prometheus"] as const)

// SWE-2 ids are kimi-k3 under the hood, but the plugin ships a distinct swe-2 variant that must
// win over kimi-k3; the runtime resolves them to the same kimi-k3 preset either way.
const PRESET_MATCHERS: ReadonlyArray<readonly [variant: string, matcher: ProviderAwareMatcher]> = [
  ["gpt-6-astra", isGpt6FamilyModel],
  ["gpt-5.6", isGpt56Model],
  ["gpt-5.5", isGpt55Model],
  ["gpt-5.4", isGpt54Model],
  ["gpt-5.3-codex", isGpt53CodexModel],
  ["gpt-5.2", isGpt52Model],
  ["swe-2", isSWE2Model],
  ["kimi-k3", isKimiK3Model],
  ["kimi-k2-8", isKimiK28Model],
  ["kimi-k2-7", isKimiK2CodeModel],
  ["kimi-k2-6", isKimiK26Model],
  ["fable-5-1", isClaudeFable51Model],
  ["fable-5", isClaudeFable5Model],
  ["opus-5-5", isClaudeOpus55Model],
  ["opus-5", isClaudeOpus5LegacyModel],
  ["sonnet-5-5", isClaudeSonnet55Model],
  ["haiku-5-5", isClaudeHaiku55Model],
  ["opus-4-8", isClaudeOpus48Model],
  ["opus-4-7", isClaudeOpus47Model],
  ["opus-4-6", isClaudeOpus46Model],
  ["opus-4-5", isClaudeOpus45Model],
  ["glm-5.3", isGlm53Model],
  ["glm-5.2", isGlm52Model],
  ["deepseek-v4-flash-0731", isDeepseekV4Flash0731Model],
  ["deepseek-v4-1-flash", isDeepseekV41FlashOrRetiredAlias],
  ["deepseek-v4-flash", isDeepseekV4FlashModel],
  ["deepseek-v4-pro", isDeepseekV4ProModel],
  ["gpt-5", isGpt5ExactModel],
  ["gpt", isGptModel],
  ["gemini", isGeminiModel],
  ["kimi", isKimiK2Model],
  ["glm", isGlmModel],
  ["grok-4.7", isGrok47Model],
  ["grok-4.6", isGrok46Model],
  ["grok-4.5", isGrok45Model],
  ["minimax", isMiniMaxModel],
] as const

// gpt-5 names only the bare release: a table without gpt-5.x variants must not let gpt-5.5 claim
// the gpt-5 slot, so the bare-id matcher rejects any version suffix beyond the major.
function isGpt5ExactModel(model: string): boolean {
  return isGpt5Model(model) && !isGpt52Model(model) && !isGpt53CodexModel(model) && !isGpt54Model(model) &&
    !isGpt55Model(model) && !isGpt56Model(model)
}

// The retired official alias deepseek/deepseek-v4-flash resolves to the v4.1-flash preset
// (mirroring the runtime); the unqualified deepseek-v4-flash id keeps its own variant, so the
// alias match is gated on the provider namespace.
function isDeepseekV41FlashOrRetiredAlias(modelID: string, providerID?: string): boolean {
  if (isDeepseekV41FlashModel(modelID)) return true
  const slash = modelID.indexOf("/")
  const bareModelID = slash === -1 ? modelID : modelID.slice(slash + 1)
  const resolvedProviderID = providerID ?? (slash === -1 ? undefined : modelID.slice(0, slash))
  return resolvedProviderID === "deepseek" && bareModelID === "deepseek-v4-flash"
}

export function resolveVariant(input: ResolveVariantInput): string {
  const variantNames = Object.keys(input.variants)
  if (variantNames.length === 0) {
    throw new TypeError("resolveVariant requires at least one prompt variant")
  }

  if (isPlannerAgent(input.agentName) && variantNames.includes("planner")) {
    return "planner"
  }

  if (input.modelID !== undefined) {
    for (const [variantName, matcher] of PRESET_MATCHERS) {
      if (!variantNames.includes(variantName)) continue
      if (matcher(input.modelID, input.providerID)) return variantName
    }
  }

  if (variantNames.includes("default")) return "default"

  return variantNames[0]
}

function isPlannerAgent(agentName: string | undefined): boolean {
  return agentName !== undefined && PLANNER_AGENT_NAMES.has(agentName.toLowerCase())
}
