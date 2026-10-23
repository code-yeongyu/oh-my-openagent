const HARNESS_BLOCKS = ["[opencode]", "[native]", "[senpi]", "[codex]"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Rename only config containers; keys inside opaque extension settings are user data. */
export function migrateLegacyDoriSection(document: unknown): {
  readonly document: Record<string, unknown>
  readonly diagnostics: readonly string[]
} {
  if (!isRecord(document)) return { document: {}, diagnostics: [] }
  const diagnostics: string[] = []
  const rename = (container: Record<string, unknown>, path: readonly string[]): Record<string, unknown> => {
    const result = { ...container }
    if (Object.hasOwn(container, "gateway")) {
      if (Object.hasOwn(container, "dori")) {
        diagnostics.push(`${[...path, "gateway"].join(".")} removed: dori is already configured`)
      } else {
        result.dori = container.gateway
        diagnostics.push(`${[...path, "gateway"].join(".")} renamed to dori`)
      }
      delete result.gateway
    }
    return result
  }
  const layer = (container: Record<string, unknown>, path: readonly string[]): Record<string, unknown> => {
    const result = rename(container, path)
    for (const key of HARNESS_BLOCKS) {
      const block = container[key]
      if (isRecord(block)) result[key] = rename(block, [...path, key])
    }
    return result
  }
  const result = layer(document, [])
  if (isRecord(document.profiles)) {
    const profiles: Record<string, unknown> = {}
    for (const [name, profile] of Object.entries(document.profiles)) {
      profiles[name] = isRecord(profile) ? layer(profile, ["profiles", name]) : profile
    }
    result.profiles = profiles
  }
  return { document: result, diagnostics }
}

export function hasLegacyGatewaySection(document: unknown): boolean {
  return migrateLegacyDoriSection(document).diagnostics.length > 0
}
