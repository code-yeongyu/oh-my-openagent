export type ExactAliasRule = {
  aliasModelID: string
  ruleID: string
  canonicalModelID: string
  rationale: string
}

export type PatternAliasRule = {
  ruleID: string
  description: string
  match: (normalizedModelID: string) => boolean
  canonicalize: (normalizedModelID: string) => string
}

export type ModelIDAliasResolution = {
  requestedModelID: string
  canonicalModelID: string
  source: "canonical" | "exact-alias" | "pattern-alias"
  ruleID?: string
}

const EXACT_ALIAS_RULES: ReadonlyArray<ExactAliasRule> = [
  {
    aliasModelID: "gemini-3.1-pro-high",
    ruleID: "gemini-3.1-pro-tier-alias",
    canonicalModelID: "gemini-3.1-pro",
    rationale: "OmO historically encoded Gemini tier selection in the model name instead of variant metadata.",
  },
  {
    aliasModelID: "gemini-3.1-pro-low",
    ruleID: "gemini-3.1-pro-tier-alias",
    canonicalModelID: "gemini-3.1-pro",
    rationale: "OmO historically encoded Gemini tier selection in the model name instead of variant metadata.",
  },
  {
    aliasModelID: "gemini-3-pro-high",
    ruleID: "gemini-3-pro-tier-alias",
    canonicalModelID: "gemini-3-pro-preview",
    rationale: "Legacy Gemini 3 tier suffixes still need to land on the canonical preview model.",
  },
  {
    aliasModelID: "gemini-3-pro-low",
    ruleID: "gemini-3-pro-tier-alias",
    canonicalModelID: "gemini-3-pro-preview",
    rationale: "Legacy Gemini 3 tier suffixes still need to land on the canonical preview model.",
  },
  {
    aliasModelID: "claude-opus-4-6-thinking",
    ruleID: "claude-opus-4-6-thinking-legacy-alias",
    canonicalModelID: "claude-opus-4-6",
    rationale: "OmO historically used a legacy compatibility suffix before models.dev shipped canonical thinking variants for newer Claude families.",
  },
]

const EXACT_ALIAS_RULES_BY_MODEL: ReadonlyMap<string, ExactAliasRule> = new Map(
  EXACT_ALIAS_RULES.map((rule) => [rule.aliasModelID, rule]),
)

const PATTERN_ALIAS_RULES: ReadonlyArray<PatternAliasRule> = []

function normalizeLookupModelID(modelID: string): string {
  return modelID.trim().toLowerCase()
}

export function resolveModelIDAlias(modelID: string): ModelIDAliasResolution {
  const normalizedModelID = normalizeLookupModelID(modelID)
  const exactRule = EXACT_ALIAS_RULES_BY_MODEL.get(normalizedModelID)
  if (exactRule) {
    return {
      requestedModelID: normalizedModelID,
      canonicalModelID: exactRule.canonicalModelID,
      source: "exact-alias",
      ruleID: exactRule.ruleID,
    }
  }

  for (const rule of PATTERN_ALIAS_RULES) {
    if (!rule.match(normalizedModelID)) {
      continue
    }

    return {
      requestedModelID: normalizedModelID,
      canonicalModelID: rule.canonicalize(normalizedModelID),
      source: "pattern-alias",
      ruleID: rule.ruleID,
    }
  }

  return {
    requestedModelID: normalizedModelID,
    canonicalModelID: normalizedModelID,
    source: "canonical",
  }
}

export function getExactModelIDAliasRules(): ReadonlyArray<ExactAliasRule> {
  return EXACT_ALIAS_RULES
}

export function getPatternModelIDAliasRules(): ReadonlyArray<PatternAliasRule> {
  return PATTERN_ALIAS_RULES
}
