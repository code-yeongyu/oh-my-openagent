import {
  isClaudeOpus47Model,
  isGeminiModel,
  isGlmModel,
  isGptModel,
  isKimiK2Model,
  isMiniMaxModel,
} from "@oh-my-opencode/model-core"
import type { VariantTable } from "./types"

export type ResolveVariantInput = {
  readonly modelID?: string
  readonly agentName?: string
  readonly variants: VariantTable
}

const PLANNER_AGENT_NAMES = new Set(["prometheus"])

const MODEL_MATCHERS: Record<string, (modelID: string) => boolean> = {
  gpt: isGptModel,
  gemini: isGeminiModel,
  kimi: isKimiK2Model,
  glm: isGlmModel,
  "opus-4-7": isClaudeOpus47Model,
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

  const firstVariant = variantNames[0]
  if (firstVariant !== undefined) return firstVariant

  throw new TypeError("resolveVariant requires at least one prompt variant")
}

function isPlannerAgent(agentName: string | undefined): boolean {
  return agentName !== undefined && PLANNER_AGENT_NAMES.has(agentName.toLowerCase())
}

function matchesModelVariant(variantName: string, modelID: string): boolean {
  const matcher = MODEL_MATCHERS[variantName]
  return matcher?.(modelID) ?? false
}
