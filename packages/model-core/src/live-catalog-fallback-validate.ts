/**
 * Validate fallback model IDs against a live gateway catalog.
 * Addresses https://github.com/code-yeongyu/oh-my-openagent/issues/8449
 */

export type LiveCatalogValidation = {
  knownIds: ReadonlySet<string>
  catalogRefreshed: boolean
}

export type FallbackCatalogFinding = {
  modelId: string
  status: "ok" | "unknown-after-refresh" | "skipped-stale-catalog"
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

export function validateFallbackModelsAgainstLiveCatalog(
  fallbackModelIds: readonly string[],
  catalog: LiveCatalogValidation,
): FallbackCatalogFinding[] {
  const known = new Set([...catalog.knownIds].map(normalizeId))
  return fallbackModelIds.map((raw) => {
    const modelId = raw.trim()
    if (!modelId) return { modelId: raw, status: "unknown-after-refresh" as const }
    if (!catalog.catalogRefreshed) return { modelId, status: "skipped-stale-catalog" as const }
    return {
      modelId,
      status: known.has(normalizeId(modelId))
        ? ("ok" as const)
        : ("unknown-after-refresh" as const),
    }
  })
}

export function unknownFallbackModelsAfterLiveRefresh(
  findings: readonly FallbackCatalogFinding[],
): string[] {
  return findings.filter((f) => f.status === "unknown-after-refresh").map((f) => f.modelId)
}
