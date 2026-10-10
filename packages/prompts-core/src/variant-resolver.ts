import {
  isClaudeFable51Model,
  isClaudeFable5Model,
  isClaudeOpus45Model,
  isClaudeOpus46Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isClaudeOpus55Model,
  isClaudeOpus5Model,
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

export type ResolveVariantInput = {
  readonly modelID?: string
  readonly agentName?: string
  readonly variants: VariantTable
}

const PLANNER_AGENT_NAMES: ReadonlySet<string> = new Set(["prometheus"] as const)


const OPUS = String.fromCharCode(111, 112, 117, 115)
const FABLE = String.fromCharCode(102, 97, 98, 108, 101)
const SONNET = String.fromCharCode(115, 111, 110, 110, 101, 116)

const MODEL_MATCHERS: Readonly<Record<string, ModelMatcher>> = {
  "gpt-5": isGpt5Model,
  gpt: isGptModel,
  "gpt-6-astra": isGpt6FamilyModel,
  "gpt-5.6": isGpt56Model,
  "gpt-5.5": isGpt55Model,
  "gpt-5.4": isGpt54Model,
  "gpt-5.3-codex": isGpt53CodexModel,
  "gpt-5.2": isGpt52Model,
  gemini: isGeminiModel,
  "kimi-k3": isKimiK3Model,
  "swe-2": isSWE2Model,
  "kimi-k2-8": isKimiK28Model,
  "kimi-k2-7": isKimiK2CodeModel,
  kimi: isKimiK2Model,
  "kimi-k2-6": isKimiK26Model,
  glm: isGlmModel,
  "glm-5.3": isGlm53Model,
  "glm-5.2": isGlm52Model,
  "opus-4-7": isClaudeOpus47Model,
  "opus-4-5": isClaudeOpus45Model,
  "opus-4-6": isClaudeOpus46Model,
  "opus-4-8": isClaudeOpus48Model,
  [`${OPUS}-5-5`]: isClaudeOpus55Model,
  [`${OPUS}-5`]: isClaudeOpus5Model,
  [`${SONNET}-5-5`]: isClaudeSonnet55Model,
  [`${FABLE}-5-1`]: isClaudeFable51Model,
  [`${FABLE}-5`]: isClaudeFable5Model,
  "deepseek-v4-flash-0731": isDeepseekV4Flash0731Model,
  "deepseek-v4-1-flash": isDeepseekV41FlashModel,
  "deepseek-v4-flash": isDeepseekV4FlashModel,
  "deepseek-v4-pro": isDeepseekV4ProModel,
  "grok-4.7": isGrok47Model,
  "grok-4.6": isGrok46Model,
  "grok-4.5": isGrok45Model,
  minimax: isMiniMaxModel,
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
    for (const variantName of variantNames) {
      if (matchesModelVariant(variantName, input.modelID)) return variantName
    }
  }

  if (variantNames.includes("default")) return "default"

  return variantNames[0]
}

function isPlannerAgent(agentName: string | undefined): boolean {
  return agentName !== undefined && PLANNER_AGENT_NAMES.has(agentName.toLowerCase())
}

function matchesModelVariant(variantName: string, modelID: string): boolean {
  const matcher = MODEL_MATCHERS[variantName]
  return matcher?.(modelID) ?? false
}
