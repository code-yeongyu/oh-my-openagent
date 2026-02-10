import { HookNameSchema } from "../../config/schema/hooks"
import { HOOK_NAME_MAP } from "../../shared/migration/hook-names"

type LegacyHooksJson = {
  disabled_hooks?: unknown
  hooks?: unknown
}

export interface HooksConfigAdaptation {
  disabledHooks: string[]
  warnings: string[]
}

function normalizeRawHooks(parsed: LegacyHooksJson): string[] {
  if (Array.isArray(parsed.disabled_hooks)) {
    return parsed.disabled_hooks.filter((item): item is string => typeof item === "string")
  }

  if (Array.isArray(parsed.hooks)) {
    return parsed.hooks.filter((item): item is string => typeof item === "string")
  }

  return []
}

function mapLegacyName(name: string): string | null {
  const mapped = HOOK_NAME_MAP[name]
  if (mapped === null) {
    return null
  }

  return mapped ?? name
}

export function adaptLegacyHooksConfig(raw: string): HooksConfigAdaptation {
  let parsed: LegacyHooksJson
  try {
    parsed = JSON.parse(raw) as LegacyHooksJson
  } catch {
    return {
      disabledHooks: [],
      warnings: ["Invalid hooks.json: failed to parse JSON"],
    }
  }

  const warnings: string[] = []
  const normalized = new Set<string>()

  for (const hook of normalizeRawHooks(parsed)) {
    const mapped = mapLegacyName(hook)

    if (mapped === null) {
      warnings.push(`Removed legacy hook ignored: ${hook}`)
      continue
    }

    if (!HookNameSchema.safeParse(mapped).success) {
      warnings.push(`Unknown hook ignored: ${hook}`)
      continue
    }

    normalized.add(mapped)
  }

  return {
    disabledHooks: [...normalized],
    warnings,
  }
}
