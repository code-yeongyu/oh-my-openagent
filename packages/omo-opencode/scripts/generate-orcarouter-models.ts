#!/usr/bin/env bun
// Generates src/features/orcarouter-provider/orcarouter-models.json.
//
// OrcaRouter (https://api.orcarouter.ai) serves an OpenAI-compatible catalog at
// GET /v1/models whose `orcarouter/*` ids are the gateway's own routing
// products: the Auto Router (`orcarouter/auto`), the free tier
// (`orcarouter/free`), and the Fusion panel variants (`orcarouter/fusion*`).
// The endpoint also exposes third-party model ids (openai/, anthropic/, ...)
// that opencode already reaches through their native providers, so only the
// `orcarouter/*` namespace is catalogued here.
//
// The authoritative metadata for `orcarouter/auto` lives in the models.dev
// `orcarouter` provider catalog (name, capabilities, limits). The gateway
// endpoint contributes the context-window it reports and the product ids it
// serves that models.dev does not list.
//
// Usage: bun run packages/omo-opencode/scripts/generate-orcarouter-models.ts

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const ORCAROUTER_MODELS_URL = "https://api.orcarouter.ai/v1/models"
const MODELS_DEV_URL = "https://models.dev/api.json"
// models.dev answers plain programmatic clients with HTTP 403.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export interface OrcaRouterCatalogModel {
  readonly id: string
  readonly context_length?: number
}

export interface OrcaRouterCatalogResponse {
  readonly data?: readonly OrcaRouterCatalogModel[]
}

/** Subset of the models.dev model entry used for OrcaRouter enrichment. */
export interface ModelsDevModel {
  readonly name?: string
  readonly tool_call?: boolean
  readonly reasoning?: boolean
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly cost?: {
    readonly input?: number
    readonly output?: number
    readonly cache_read?: number
    readonly cache_write?: number
  }
}

export type ModelsDevCatalogs = Readonly<
  Record<string, { readonly models?: Readonly<Record<string, ModelsDevModel>> } | undefined>
>

/** opencode custom-provider model config entry. */
export interface OrcaRouterModelEntry {
  readonly name: string
  readonly reasoning: boolean
  readonly tool_call: boolean
  readonly attachment: boolean
  readonly modalities: { readonly input: readonly string[]; readonly output: readonly ["text"] }
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cache_read: number
    readonly cache_write: number
  }
  readonly limit: { readonly context: number; readonly output: number }
}

export type OrcaRouterCatalog = Readonly<Record<string, OrcaRouterModelEntry>>

/**
 * Routing products served by the gateway itself rather than third-party
 * providers. Test and internal ids are excluded from the checked-in catalog.
 */
const PRODUCT_MODEL_PATTERN = /^orcarouter\/(auto|free|fusion|fusion-flash|fusion-mini|open-code|code-review)$/
const EXCLUDED_MODEL_IDS = new Set([
  "orcarouter/test-cache-glm52-opus",
  "orcarouter/simple-test",
  "orcarouter/intco-qa",
])

function isProductModel(id: string): boolean {
  if (EXCLUDED_MODEL_IDS.has(id)) return false
  return PRODUCT_MODEL_PATTERN.test(id)
}

const MODELS_DEV_PROVIDER = "orcarouter"
const LIMIT_FLOOR = 4096
// The gateway does not publish per-model pricing; it bills at the upstream
// provider's published price (zero markup), so costs default to 0.
const DEFAULT_COST = { input: 0, output: 0, cache_read: 0, cache_write: 0 }

/**
 * Display names for routing products the endpoint serves but models.dev does
 * not list. models.dev is authoritative for `orcarouter/auto`; the rest are
 * named after the product tiers OrcaRouter documents.
 */
const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  "orcarouter/auto": "OrcaRouter Auto",
  "orcarouter/free": "OrcaRouter Free",
  "orcarouter/fusion": "OrcaRouter Fusion",
  "orcarouter/fusion-flash": "OrcaRouter Fusion Flash",
  "orcarouter/fusion-mini": "OrcaRouter Fusion Mini",
}

export function buildOrcaRouterCatalog(
  response: OrcaRouterCatalogResponse,
  modelsDev: ModelsDevCatalogs,
): OrcaRouterCatalog {
  const providerCatalog = modelsDev[MODELS_DEV_PROVIDER]?.models ?? {}
  const endpointModels = new Map<string, number | undefined>()
  for (const item of response.data ?? []) {
    if (isProductModel(item.id)) endpointModels.set(item.id, item.context_length)
  }

  // Start from the models.dev `orcarouter` provider catalog (authoritative for
  // `orcarouter/auto`), then add product ids the endpoint serves that models.dev
  // does not list. The endpoint's context-window overrides models.dev when both
  // are present.
  const ids = new Set<string>([...Object.keys(providerCatalog).filter(isProductModel), ...endpointModels.keys()])
  const catalog: Record<string, OrcaRouterModelEntry> = {}

  for (const id of [...ids].sort()) {
    const source = providerCatalog[id]
    const endpointContext = endpointModels.get(id)
    const context = endpointContext ?? source?.limit?.context ?? LIMIT_FLOOR
    const output = source?.limit?.output ?? LIMIT_FLOOR

    catalog[id] = {
      name: source?.name ?? PRODUCT_NAMES[id] ?? id,
      // Routing products resolve to tool-capable upstream models; without a
      // models.dev entry the gateway guarantee is assumed.
      reasoning: source?.reasoning === true,
      tool_call: source?.tool_call === true || source === undefined,
      attachment: source?.modalities?.input?.includes("image") ?? false,
      modalities: { input: source?.modalities?.input ?? ["text"], output: ["text"] },
      cost: {
        input: source?.cost?.input ?? DEFAULT_COST.input,
        output: source?.cost?.output ?? DEFAULT_COST.output,
        cache_read: source?.cost?.cache_read ?? DEFAULT_COST.cache_read,
        cache_write: source?.cost?.cache_write ?? DEFAULT_COST.cache_write,
      },
      limit: { context, output },
    }
  }

  return catalog
}

export function serializeOrcaRouterCatalog(catalog: OrcaRouterCatalog): string {
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return `${JSON.stringify(sorted, undefined, 2)}\n`
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": BROWSER_USER_AGENT, accept: "application/json" } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return await response.json()
}

async function main(): Promise<void> {
  const [gateway, modelsDev] = await Promise.all([fetchJson(ORCAROUTER_MODELS_URL), fetchJson(MODELS_DEV_URL)])
  const catalog = buildOrcaRouterCatalog(gateway as OrcaRouterCatalogResponse, modelsDev as ModelsDevCatalogs)
  const count = Object.keys(catalog).length
  if (count === 0) throw new Error("OrcaRouter catalog came back empty; refusing to overwrite the checked-in JSON")

  const outputPath = join(
    dirname(dirname(new URL(import.meta.url).pathname)),
    "src/features/orcarouter-provider/orcarouter-models.json",
  )
  await writeFile(outputPath, serializeOrcaRouterCatalog(catalog), "utf8")
  console.log(`Wrote ${count} models to ${outputPath}`)
}

if (import.meta.main) {
  await main()
}
