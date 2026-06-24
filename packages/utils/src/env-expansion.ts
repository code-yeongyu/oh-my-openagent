import { isUnsafeObjectKey } from "./deep-merge"

type EnvMap = Readonly<Record<string, string | undefined>>

export type EnvExpansionBlockedReason = "not_allowed"

export type EnvExpansionOptions = {
  readonly env?: EnvMap
  readonly trusted?: boolean
  readonly isAllowed?: (name: string) => boolean
  readonly onBlocked?: (name: string, reason: EnvExpansionBlockedReason) => void
}

const ENV_REFERENCE_PATTERN = /\$\{([^}:]+)(?::-([^}]*))?\}/g

function isAllowedByDefault(_name: string): boolean {
  return true
}

export function expandEnvReferences(value: string, options: EnvExpansionOptions = {}): string {
  const env = options.env ?? process.env
  const trusted = options.trusted ?? false
  const isAllowed = options.isAllowed ?? isAllowedByDefault

  return value.replace(ENV_REFERENCE_PATTERN, (_match, varName: string, defaultValue?: string) => {
    if (!trusted && !isAllowed(varName)) {
      options.onBlocked?.(varName, "not_allowed")
      return defaultValue ?? ""
    }

    return env[varName] ?? defaultValue ?? ""
  })
}

export function expandEnvReferencesInObject(value: unknown, options: EnvExpansionOptions = {}): unknown {
  if (value == null) return value
  if (typeof value === "string") return expandEnvReferences(value, options)
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvReferencesInObject(item, options))
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      if (isUnsafeObjectKey(key)) continue
      result[key] = expandEnvReferencesInObject(nestedValue, options)
    }
    return result
  }
  return value
}
