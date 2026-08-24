import { normalizeModelID } from "./model-normalization"
import { parseVariantFromModelID } from "./model-string-parser"

export type HeuristicModelFamilyDefinition = {
  family: string
  includes?: string[]
  pattern?: RegExp
  variants?: string[]
  reasoningEfforts?: string[]
  reasoningEffortAliases?: Record<string, string>
  supportsTemperature?: boolean
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
    family: "openai-deep-research",
    includes: ["o3-deep-research", "o4-mini-deep-research"],
    variants: ["low", "medium", "high"],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
    supportsTemperature: true,
  },
  {
    family: "openai-reasoning",
    pattern: /(?:^|\/)o\d(?:$|-)/,
    variants: ["low", "medium", "high"],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high"],
    supportsTemperature: false,
  },
  {
    // gpt-5.6 dropped "minimal" from reasoning.effort. The API rejects it with a
    // 400 unsupported_value instead of degrading, which killed every memory
    // reflection run against gpt-5.6-luna. Must precede the generic gpt-5 entry
    // below (first match wins), which still advertises "minimal" for gpt-5/5.1.
    // Model IDs are normalized before matching, so "gpt-5.6-luna" arrives here as
    // "gpt-5-6-luna" - match the hyphenated form, not the dotted one.
    family: "gpt-5-6-plus",
    pattern: /gpt-5-(?:[6-9]|\d{2,})(?:$|-)/,
    variants: ["low", "medium", "high", "xhigh"],
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    reasoningEffortAliases: {
      minimal: "none",
    },
  },
  {
    family: "gpt-5",
    includes: ["gpt-5"],
    variants: ["low", "medium", "high", "xhigh"],
    reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
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
    family: "qwen",
    includes: ["qwen"],
  },
  {
    family: "grok",
    includes: ["grok"],
    variants: ["low", "medium", "high"],
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    family: "kimi-thinking",
    includes: ["kimi-thinking", "k2-thinking", "k2-think"],
    // Matches models with -thinking/-think suffix, OR k2p* models (k2p5, k2p6, k2-p6, k2.p6)
    // which are kimi-for-coding provider models that support thinking (#3945, #4418, #4707).
    pattern: /(?:kimi.*-(?:thinking|think)|k2(?:.*-(?:thinking|think)|[-.]?p\d))/,
    variants: ["low", "medium", "high"],
    supportsThinking: true,
  },
  {
    family: "kimi",
    // Match "kimi" anywhere, or "k2" NOT followed by optional separator + "p" + digit.
    // Excludes k2p6, k2-p6, k2.p6 from kimi-for-coding which support thinking (#4418).
    pattern: /(?:kimi|k2(?![-.]?p\d))/,
    variants: ["low", "medium", "high"],
    supportsThinking: false,
  },
  {
    family: "glm",
    includes: ["glm"],
    variants: ["low", "medium", "high", "max"],
    reasoningEfforts: ["high", "max"],
    reasoningEffortAliases: {
      low: "high",
      medium: "high",
      xhigh: "max",
    },
  },
  {
    family: "minimax",
    includes: ["minimax"],
    variants: ["low", "medium", "high"],
    supportsThinking: false,
  },
  {
    family: "deepseek",
    includes: ["deepseek"],
    variants: ["low", "medium", "high", "max"],
    reasoningEfforts: ["high", "max"],
    reasoningEffortAliases: {
      low: "high",
      medium: "high",
      xhigh: "max",
    },
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
  const parsedModel = parseVariantFromModelID(modelID, { allowMaxSuffix: true })
  const normalizedModelID = normalizeModelID(parsedModel.modelID).toLowerCase()

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
