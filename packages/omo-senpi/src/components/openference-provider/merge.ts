/**
 * Fill-only-missing merge of the openference provider block into the engine's
 * models.json document (Pi `docs/models.md` provider-config form).
 *
 * Invariants, matching the OpenCode-side openference provider:
 * - a value the user already wrote always survives verbatim (provider fields,
 *   header values, and whole model entries identified by `id`);
 * - when nothing is missing the result reports `changed: false` so the caller
 *   leaves the file byte-identical on disk;
 * - an incompatible existing shape (models.json not an object, `providers` not
 *   an object, a non-object `openference` value, a non-array `models`) aborts
 *   the merge by returning undefined instead of rewriting user config;
 * - removal never happens: a credential that disappears later leaves the
 *   provider block in place for the user to manage.
 */

import type { OpenferenceSenpiCatalog } from "./types"

export const OPENFERENCE_PROVIDER_ID = "openference"
export const OPENFERENCE_BASE_URL = "https://api.openference.com/v1"
export const OPENFERENCE_ENV_VAR = "OPENFERENCE_API_KEY"

/** Openference rejects requests without a pi/ User-Agent with 403 "coding agent required". */
export const OPENFERENCE_USER_AGENT = "pi/openference"

export interface OpenferenceProviderMergeResult {
  readonly changed: boolean
  readonly doc: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function catalogModels(catalog: OpenferenceSenpiCatalog): unknown[] {
  return catalog.map((entry) => structuredClone(entry))
}

function defaultProviderBlock(catalog: OpenferenceSenpiCatalog): Record<string, unknown> {
  return {
    baseUrl: OPENFERENCE_BASE_URL,
    api: "openai-completions",
    apiKey: `$${OPENFERENCE_ENV_VAR}`,
    headers: { "User-Agent": OPENFERENCE_USER_AGENT },
    models: catalogModels(catalog),
  }
}

/**
 * Merges the catalog into the provider's `models` by id: user model entries
 * always win; catalog entries the user's list lacks are appended. Returns the
 * merged list plus whether anything changed, or undefined when the user shaped
 * `models` as something other than an array (never rewrite that).
 */
function mergeModels(
  existing: unknown,
  catalog: OpenferenceSenpiCatalog,
): { changed: boolean; models: unknown } | undefined {
  if (existing === undefined) {
    return { changed: catalog.length > 0, models: catalogModels(catalog) }
  }
  if (!Array.isArray(existing)) return undefined

  const knownIds = new Set(
    existing
      .map((entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : undefined))
      .filter((id): id is string => id !== undefined),
  )
  const missing = catalog.filter((entry) => !knownIds.has(entry.id))
  if (missing.length === 0) return { changed: false, models: existing }
  return { changed: true, models: [...existing, ...missing.map((entry) => structuredClone(entry))] }
}

export function mergeOpenferenceProvider(
  existing: unknown,
  catalog: OpenferenceSenpiCatalog,
): OpenferenceProviderMergeResult | undefined {
  const doc = existing === undefined ? {} : structuredClone(existing)
  if (!isRecord(doc)) return undefined

  const providers = doc.providers
  if (providers === undefined) {
    doc.providers = { [OPENFERENCE_PROVIDER_ID]: defaultProviderBlock(catalog) }
    return { changed: true, doc }
  }
  if (!isRecord(providers)) return undefined

  const provider = providers[OPENFERENCE_PROVIDER_ID]
  if (provider === undefined) {
    providers[OPENFERENCE_PROVIDER_ID] = defaultProviderBlock(catalog)
    return { changed: true, doc }
  }
  if (!isRecord(provider)) return undefined

  let changed = false

  // Provider-level defaults, filled only when absent.
  const defaults: Record<string, unknown> = {
    baseUrl: OPENFERENCE_BASE_URL,
    api: "openai-completions",
    apiKey: `$${OPENFERENCE_ENV_VAR}`,
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (provider[key] === undefined) {
      provider[key] = value
      changed = true
    }
  }

  // Headers merge fill-only-missing, one level deep.
  if (provider.headers === undefined) {
    provider.headers = { "User-Agent": OPENFERENCE_USER_AGENT }
    changed = true
  } else if (isRecord(provider.headers) && provider.headers["User-Agent"] === undefined) {
    provider.headers["User-Agent"] = OPENFERENCE_USER_AGENT
    changed = true
  }

  const mergedModels = mergeModels(provider.models, catalog)
  if (mergedModels === undefined) return undefined
  if (mergedModels.changed) {
    provider.models = mergedModels.models
    changed = true
  }

  return { changed, doc }
}
