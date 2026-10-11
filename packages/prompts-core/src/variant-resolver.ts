import { isGeminiModel, isGlmModel, isGptModel, isKimiK2CodeModel, isKimiK2Model, isKimiK3Model, isMiniMaxModel, isSWE2Model } from "@oh-my-opencode/model-core"
import type { VariantTable } from "./types"

export type ResolveVariantInput = {
  readonly modelID?: string
  readonly providerID?: string
  readonly agentName?: string
  readonly variants: VariantTable
}

const PLANNER_AGENT_NAMES: ReadonlySet<string> = new Set(["prometheus"])

// Mode overlays have coarse harness-specific families. System prompts do not use this resolver.
const MODE_MATCHERS: ReadonlyArray<readonly [string, (model: string) => boolean]> = [
  ["swe-2", isSWE2Model],
  ["kimi-k3", isKimiK3Model],
  ["kimi-k2-7", isKimiK2CodeModel],
  ["gpt", isGptModel],
  ["gemini", isGeminiModel],
  ["kimi", isKimiK2Model],
  ["glm", isGlmModel],
  ["minimax", isMiniMaxModel],
]

export function resolveVariant(input: ResolveVariantInput): string {
  const variantNames = Object.keys(input.variants)
  if (variantNames.length === 0) {
    throw new TypeError("resolveVariant requires at least one prompt variant")
  }

  if (isPlannerAgent(input.agentName) && variantNames.includes("planner")) {
    return "planner"
  }

  if (input.modelID !== undefined) {
    for (const [variantName, matcher] of MODE_MATCHERS) {
      if (!variantNames.includes(variantName)) continue
      if (matcher(input.modelID)) return variantName
    }
  }

  if (variantNames.includes("default")) return "default"

  return variantNames[0]
}

function isPlannerAgent(agentName: string | undefined): boolean {
  return agentName !== undefined && PLANNER_AGENT_NAMES.has(agentName.toLowerCase())
}
