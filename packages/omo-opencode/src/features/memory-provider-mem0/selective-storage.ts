export interface SelectiveStorageRules {
  includes?: string
  excludes?: string
}

export interface SelectiveStorageConfig {
  rules: SelectiveStorageRules
  max_rule_length?: number
}

export class SelectiveStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SelectiveStorageError"
  }
}

const DEFAULT_MAX_LENGTH = 500

export function validateSelectiveStorage(
  rules: SelectiveStorageRules,
  max_rule_length = DEFAULT_MAX_LENGTH,
): void {
  if (!rules.includes && !rules.excludes) {
    return
  }
  if (rules.includes !== undefined) {
    if (typeof rules.includes !== "string") {
      throw new SelectiveStorageError("includes must be a string instruction")
    }
    if (rules.includes.length > max_rule_length) {
      throw new SelectiveStorageError(
        `includes exceeds max length ${max_rule_length} (got ${rules.includes.length})`,
      )
    }
  }
  if (rules.excludes !== undefined) {
    if (typeof rules.excludes !== "string") {
      throw new SelectiveStorageError("excludes must be a string instruction")
    }
    if (rules.excludes.length > max_rule_length) {
      throw new SelectiveStorageError(
        `excludes exceeds max length ${max_rule_length} (got ${rules.excludes.length})`,
      )
    }
  }
}

export function buildSelectiveStorageParams(
  rules: SelectiveStorageRules,
): Record<string, string> {
  validateSelectiveStorage(rules)
  const params: Record<string, string> = {}
  if (rules.includes && rules.includes.trim() !== "") {
    params.includes = rules.includes.trim()
  }
  if (rules.excludes && rules.excludes.trim() !== "") {
    params.excludes = rules.excludes.trim()
  }
  return params
}

export const STORAGE_PRESETS: Record<string, SelectiveStorageRules> = {
  preferences_only: {
    includes: "Store only user preferences, settings, and explicit likes/dislikes",
    excludes: "Do not store personal identifiers, payment info, or conversation small talk",
  },
  technical_only: {
    includes: "Store technical facts, code patterns, architectural decisions, and tooling choices",
    excludes: "Do not store personal information or casual conversation",
  },
  no_pii: {
    excludes: "Do not store names, emails, phone numbers, addresses, or government IDs",
  },
  long_term_facts: {
    includes: "Store stable facts that will remain true long term",
    excludes: "Do not store transient details, current state, or time-bounded context",
  },
}

export function getStoragePreset(name: string): SelectiveStorageRules | undefined {
  return STORAGE_PRESETS[name]
}

export function mergeStorageRules(
  base: SelectiveStorageRules,
  override: SelectiveStorageRules,
): SelectiveStorageRules {
  return {
    includes: override.includes ?? base.includes,
    excludes: override.excludes ?? base.excludes,
  }
}
