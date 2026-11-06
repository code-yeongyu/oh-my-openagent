/**
 * `contextWindow` is a prompt budget, not a total window: the Responses API rejects a prompt above
 * (documented window - max output), the split senpi's own `applyOpenAiInputCap` applies when it
 * generates catalogs. Deriving windows from the subscription must use the same rule.
 */

export type ReportedWindow = {
  readonly slug: string
  readonly contextWindow: number
  readonly maxContextWindow: number
}

export type CatalogRow = {
  readonly id: string
  readonly contextWindow: number
  readonly maxTokens: number
}

export type WidenedWindow = {
  readonly id: string
  readonly slug: string
  readonly from: number
  readonly to: number
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parseReportedWindows(payload: unknown): ReportedWindow[] {
  const container = asRecord(payload)
  const raw = Array.isArray(payload) ? payload : Array.isArray(container?.models) ? container.models : []

  const windows: ReportedWindow[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    if (record === undefined) continue
    const slug = typeof record.slug === "string" ? record.slug.trim() : ""
    const maxContextWindow = positiveInteger(record.max_context_window)
    if (slug === "" || maxContextWindow === undefined) continue
    windows.push({
      slug,
      contextWindow: positiveInteger(record.context_window) ?? maxContextWindow,
      maxContextWindow,
    })
  }
  return windows
}

const VARIANT_SUFFIXES = ["-fast", "-ultrafast"] as const

/** Only the catalog's own variant suffixes map to a base slug, so an unrelated sibling is left alone. */
export function matchReportedSlug(modelId: string, slugs: readonly string[]): string | undefined {
  if (slugs.includes(modelId)) return modelId
  for (const suffix of VARIANT_SUFFIXES) {
    if (!modelId.endsWith(suffix)) continue
    const base = modelId.slice(0, -suffix.length)
    if (slugs.includes(base)) return base
  }
  return undefined
}

/** Raise only: a catalog value above what the endpoint reports is a deliberate tier choice. */
export function computeWidenedWindows(
  rows: readonly CatalogRow[],
  reported: readonly ReportedWindow[],
): WidenedWindow[] {
  const bySlug = new Map(reported.map((window) => [window.slug, window]))
  const slugs = [...bySlug.keys()]

  const widened: WidenedWindow[] = []
  for (const row of rows) {
    const slug = matchReportedSlug(row.id, slugs)
    if (slug === undefined) continue
    const window = bySlug.get(slug)
    if (window === undefined) continue

    const promptBudget = window.maxContextWindow - row.maxTokens
    if (promptBudget <= row.contextWindow) continue
    widened.push({ id: row.id, slug, from: row.contextWindow, to: promptBudget })
  }
  return widened
}
