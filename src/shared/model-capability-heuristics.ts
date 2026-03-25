import { normalizeModelID } from "./model-normalization"

export type HeuristicModelFamilyDefinition = {
  family: string
  includes?: string[]
  pattern?: RegExp
  variants?: string[]
  reasoningEfforts?: string[]
  supportsThinking?: boolean
}

export const HEURISTIC_MODEL_FAMILY_REGISTRY: ReadonlyArray<HeuristicModelFamilyDefinition> = [
  {
    family: "claude-opus",
    pattern: /claude(?:-\d+(?:-\d+)*)?-opus/,
    variants: ["low", "medium", "high", "max"],
    supportsThinking: true,
  },
  {
    family: "claude-non-opus",
    includes: ["claude"],
    variants: ["low", "medium", "high"],
    supportsThinking: true,
  },
  {
    family: "openai-reasoning",
    pattern: /(?:^|\/)o\d(?:$|-)/,
    variants: ["low", "medium", "high"],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
  },
  {
    family: "gpt-5",
    includes: ["gpt-5"],
    variants: ["low", "medium", "high", "xhigh"],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
  },
  {
    family: "gpt-legacy",
    includes: ["gpt"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "gemini",
    includes: ["gemini"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "kimi",
    includes: ["kimi", "k2"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "glm",
    includes: ["glm"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "minimax",
    includes: ["minimax"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "deepseek",
    includes: ["deepseek"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "mistral",
    includes: ["mistral", "codestral"],
    variants: ["low", "medium", "high"],
  },
  {
    family: "llama",
    includes: ["llama"],
    variants: ["low", "medium", "high"],
  },
]

export function detectHeuristicModelFamily(modelID: string): HeuristicModelFamilyDefinition | undefined {
  const normalizedModelID = normalizeModelID(modelID).toLowerCase()

  for (const definition of HEURISTIC_MODEL_FAMILY_REGISTRY) {
    if (definition.pattern?.test(normalizedModelID)) {
      return definition
    }

    if (definition.includes?.some((value) => normalizedModelID.includes(value))) {
      return definition
    }
  }

  return undefined
}
