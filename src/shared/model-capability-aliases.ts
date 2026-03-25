type ExactAliasRule = {
  ruleID: string
  canonicalModelID: string
}

type PatternAliasRule = {
  ruleID: string
  match: (normalizedModelID: string) => boolean
  canonicalize: (normalizedModelID: string) => string
}

export type ModelIDAliasResolution = {
  requestedModelID: string
  canonicalModelID: string
  source: "canonical" | "exact-alias" | "pattern-alias"
  ruleID?: string
}

const EXACT_ALIAS_RULES: Record<string, ExactAliasRule> = {
  "gpt-5.3-codex-spark": {
    ruleID: "gpt-5.3-codex-spark-alias",
    canonicalModelID: "gpt-5.3-codex",
  },
  "gemini-3.1-pro-high": {
    ruleID: "gemini-3.1-pro-tier-alias",
    canonicalModelID: "gemini-3.1-pro-preview",
  },
  "gemini-3.1-pro-low": {
    ruleID: "gemini-3.1-pro-tier-alias",
    canonicalModelID: "gemini-3.1-pro-preview",
  },
  "gemini-3-pro-high": {
    ruleID: "gemini-3-pro-tier-alias",
    canonicalModelID: "gemini-3-pro-preview",
  },
  "gemini-3-pro-low": {
    ruleID: "gemini-3-pro-tier-alias",
    canonicalModelID: "gemini-3-pro-preview",
  },
}

const PATTERN_ALIAS_RULES: ReadonlyArray<PatternAliasRule> = [
  {
    ruleID: "anthropic-thinking-suffix",
    match: (normalizedModelID) => normalizedModelID.startsWith("claude-") && normalizedModelID.endsWith("-thinking"),
    canonicalize: (normalizedModelID) => normalizedModelID.replace(/-thinking$/i, ""),
  },
]

function normalizeLookupModelID(modelID: string): string {
  return modelID.trim().toLowerCase()
}

export function resolveModelIDAlias(modelID: string): ModelIDAliasResolution {
  const normalizedModelID = normalizeLookupModelID(modelID)
  const exactRule = EXACT_ALIAS_RULES[normalizedModelID]
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
