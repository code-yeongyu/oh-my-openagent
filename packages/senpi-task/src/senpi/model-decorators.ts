export const SENPI_THINKING_LEVELS: ReadonlySet<string> = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
export const SENPI_SERVICE_TIERS: ReadonlySet<string> = new Set(["auto", "flex", "priority", "ultrafast"])

/**
 * Strip trailing `:<thinking-level>` and `:<service-tier>` decorators from a model reference,
 * right to left and at most two - the same suffix grammar senpi's `parseModelPattern` consumes
 * after its full-id match. A suffix that matches neither vocabulary stays glued to the id, so a
 * genuine colon id (`provider/model:exacto`) is never mangled.
 */
export function splitModelDecorators(
  reference: string,
  options?: { readonly thinkingOnly: boolean },
): {
  readonly base: string
  readonly thinkingLevel?: string
  readonly serviceTier?: string
} {
  let base = reference
  let thinkingLevel: string | undefined
  let serviceTier: string | undefined
  for (let count = 0; count < 2; count += 1) {
    const colon = base.lastIndexOf(":")
    if (colon <= 0) break
    const suffix = base.slice(colon + 1)
    if (thinkingLevel === undefined && SENPI_THINKING_LEVELS.has(suffix)) {
      thinkingLevel = suffix
      base = base.slice(0, colon)
      continue
    }
    if (!options?.thinkingOnly && serviceTier === undefined && SENPI_SERVICE_TIERS.has(suffix)) {
      serviceTier = suffix
      base = base.slice(0, colon)
      continue
    }
    break
  }
  return {
    base,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    ...(serviceTier === undefined ? {} : { serviceTier }),
  }
}
