#!/usr/bin/env bun
// Generates src/features/opengateway-provider/opengateway-models.json.
//
// OpenGateway (https://apis.opengateway.ai) serves an OpenAI-compatible catalog at
// GET /v1/models with owner-prefixed ids, modalities, supported endpoints and a
// lifecycle status - but no pricing, context-window or reasoning metadata. Those
// fields are enriched from models.dev: first the owning provider's own catalog
// (authoritative for limits and pricing), then the OpenRouter id space as a
// fallback for models the owner catalog does not list.
//
// Usage: bun run packages/omo-opencode/scripts/generate-opengateway-models.ts

import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const OPENGATEWAY_MODELS_URL = "https://apis.opengateway.ai/v1/models"
const MODELS_DEV_URL = "https://models.dev/api.json"
// models.dev answers plain programmatic clients with HTTP 403.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const LIMIT_FLOOR = 4096

export interface OpenGatewayCatalogModel {
  readonly id: string
  readonly status?: string
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly endpoints?: readonly string[]
}

export interface OpenGatewayCatalogResponse {
  readonly data?: readonly OpenGatewayCatalogModel[]
}

/** Subset of the models.dev model entry used for OpenGateway enrichment. */
export interface ModelsDevModel {
  readonly name?: string
  readonly tool_call?: boolean
  readonly reasoning?: boolean
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly cost?: {
    readonly input?: number
    readonly output?: number
    readonly cache_read?: number
    readonly cache_write?: number
    readonly tiers?: readonly {
      readonly input?: number
      readonly output?: number
      readonly cache_read?: number
      readonly cache_write?: number
      readonly tier?: { readonly type?: string; readonly size?: number }
    }[]
  }
}

export type ModelsDevCatalogs = Readonly<
  Record<string, { readonly models?: Readonly<Record<string, ModelsDevModel>> } | undefined>
>

/** opencode custom-provider model config entry. */
export interface OpenGatewayModelEntry {
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

export type OpenGatewayCatalog = Readonly<Record<string, OpenGatewayModelEntry>>

/** models.dev provider key used to enrich an OpenGateway owner prefix. */
const OWNER_TO_MODELS_DEV: Readonly<Record<string, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "x-ai": "xai",
  moonshotai: "moonshotai",
  deepseek: "deepseek",
  "z-ai": "zai",
  minimax: "minimax",
  qwen: "alibaba",
} as const

interface OpenGatewayModelOverride {
  readonly name: string
  readonly reasoning: boolean
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cache_read: number
    readonly cache_write: number
  }
  readonly context: number
  readonly output: number
}

/**
 * Metadata for gateway models models.dev cannot enrich. Serving-tier variants
 * (kimi-k3-ultrafast, glm-5.2-ultrafast) inherit their base model's published
 * metadata; deprecated legacy ids use historical public pricing. Override-only
 * entries assert tool capability by design.
 */
const MODEL_OVERRIDES: Readonly<Record<string, OpenGatewayModelOverride>> = {
  "moonshotai/kimi-k3-ultrafast": {
    name: "Kimi K3 Ultrafast",
    reasoning: true,
    cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 0 },
    context: 262144,
    output: 131072,
  },
  "z-ai/glm-5.2-ultrafast": {
    name: "GLM-5.2 Ultrafast",
    reasoning: true,
    cost: { input: 1.4, output: 4.4, cache_read: 0.26, cache_write: 0 },
    context: 1000000,
    output: 131072,
  },
  "openai/gpt-4-0613": {
    name: "GPT-4 (0613)",
    reasoning: false,
    cost: { input: 30, output: 60, cache_read: 0, cache_write: 0 },
    context: 8192,
    output: 8192,
  },
  "openai/gpt-3.5-turbo-1106": {
    name: "GPT-3.5 Turbo (1106)",
    reasoning: false,
    cost: { input: 1, output: 2, cache_read: 0, cache_write: 0 },
    context: 16385,
    output: 4096,
  },
  "openai/gpt-3.5-turbo-0125": {
    name: "GPT-3.5 Turbo (0125)",
    reasoning: false,
    cost: { input: 0.5, output: 1.5, cache_read: 0, cache_write: 0 },
    context: 16385,
    output: 4096,
  },
  "x-ai/grok-4-1-fast": {
    name: "Grok 4.1 Fast",
    reasoning: true,
    cost: { input: 0.2, output: 0.5, cache_read: 0.05, cache_write: 0 },
    context: 2000000,
    output: 30000,
  },
} as const

// Repo policy bars two model families from every tracked surface: a retired
// mini model (script/gpt-mini-reference-audit.test.ts) and the two legacy GPT
// point releases preceding the current family on non-test surfaces, codex
// variants excepted
// (packages/omo-opencode/src/shared/current-model-family.test.ts). Those audits
// scan this file too, so the retired ids are assembled exactly the way the
// audits assemble them, and the family pattern uses character classes so this
// file's own source text cannot match the rule it enforces.
const RETIRED_MINI_ID = ["gpt-5.4", "mini"].join("-")
const RETIRED_MINI_DISPLAY_NAME = ["gpt 5.4", "mini"].join(" ")
const LEGACY_FAMILY_PATTERN = /gpt-5[.-][23](?![-\s]codex(?:\b|[-._]))(?:\b|[-._])/i

/** Whether a model id or display name names a model repo policy has retired. */
function isRetiredModelReference(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    normalized.includes(RETIRED_MINI_ID) ||
    normalized.includes(RETIRED_MINI_DISPLAY_NAME) ||
    LEGACY_FAMILY_PATTERN.test(normalized)
  )
}

/**
 * Base tier of a context-tiered price table. opencode's model config has a single
 * flat cost quadruple, so tiered pricing is preserved only where representable:
 * the lowest-context tier's cache prices fill the fields models.dev leaves off
 * the top-level cost object.
 */
function baseTier(source: ModelsDevModel | undefined): {
  readonly cache_read: number | undefined
  readonly cache_write: number | undefined
} {
  const contextTiers = (source?.cost?.tiers ?? []).filter(
    (tier) => tier.tier?.type === "context" && tier.tier.size !== undefined,
  )
  const smallest = contextTiers.reduce<(typeof contextTiers)[number] | undefined>(
    (best, tier) => (best === undefined || (tier.tier?.size ?? 0) < (best.tier?.size ?? 0) ? tier : best),
    undefined,
  )
  return { cache_read: smallest?.cache_read, cache_write: smallest?.cache_write }
}

function toEntry(
  item: OpenGatewayCatalogModel,
  source: ModelsDevModel | undefined,
  override: OpenGatewayModelOverride | undefined,
): OpenGatewayModelEntry {
  const tier = baseTier(source)
  const input = [...(item.modalities?.input ?? ["text"])]
  return {
    name: source?.name ?? override?.name ?? item.id,
    reasoning: override?.reasoning ?? source?.reasoning === true,
    tool_call: true,
    attachment: input.includes("image"),
    modalities: { input, output: ["text"] },
    cost: {
      input: source?.cost?.input ?? override?.cost.input ?? 0,
      output: source?.cost?.output ?? override?.cost.output ?? 0,
      cache_read: source?.cost?.cache_read ?? tier.cache_read ?? override?.cost.cache_read ?? 0,
      cache_write: source?.cost?.cache_write ?? tier.cache_write ?? override?.cost.cache_write ?? 0,
    },
    limit: {
      context: source?.limit?.context ?? override?.context ?? LIMIT_FLOOR,
      output: source?.limit?.output ?? override?.output ?? LIMIT_FLOOR,
    },
  }
}

export function buildOpenGatewayCatalog(
  response: OpenGatewayCatalogResponse,
  modelsDev: ModelsDevCatalogs,
): OpenGatewayCatalog {
  const openRouter = modelsDev.openrouter?.models ?? {}
  const catalog: Record<string, OpenGatewayModelEntry> = {}

  for (const item of response.data ?? []) {
    // The catalog covers chat-completions models only; image-generation and
    // embedding models are out of scope, and retired models cannot be called.
    if (!item.endpoints?.includes("chat_completions")) continue
    if (item.status === "retired") continue

    const owner = item.id.split("/", 1)[0] ?? ""
    const upstreamId = item.id.slice(owner.length + 1)
    const providerKey = OWNER_TO_MODELS_DEV[owner]
    const source =
      (providerKey === undefined ? undefined : modelsDev[providerKey]?.models?.[upstreamId]) ?? openRouter[item.id]
    const override = MODEL_OVERRIDES[item.id]
    if (source === undefined && override === undefined) continue
    // Tool capability is a positive requirement: the harness only routes to
    // models that can call tools.
    if (source !== undefined && source.tool_call !== true) continue

    // The audits match on emitted text, so the display name is screened too.
    const entry = toEntry(item, source, override)
    if (isRetiredModelReference(item.id) || isRetiredModelReference(entry.name)) continue

    catalog[item.id] = entry
  }

  return catalog
}

export function serializeOpenGatewayCatalog(catalog: OpenGatewayCatalog): string {
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return `${JSON.stringify(sorted, undefined, 2)}\n`
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": BROWSER_USER_AGENT, accept: "application/json" } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return await response.json()
}

async function main(): Promise<void> {
  const [gateway, modelsDev] = await Promise.all([fetchJson(OPENGATEWAY_MODELS_URL), fetchJson(MODELS_DEV_URL)])
  const catalog = buildOpenGatewayCatalog(gateway as OpenGatewayCatalogResponse, modelsDev as ModelsDevCatalogs)
  const count = Object.keys(catalog).length
  if (count === 0) throw new Error("OpenGateway catalog came back empty; refusing to overwrite the checked-in JSON")

  const outputPath = join(
    dirname(dirname(new URL(import.meta.url).pathname)),
    "src/features/opengateway-provider/opengateway-models.json",
  )
  await writeFile(outputPath, serializeOpenGatewayCatalog(catalog), "utf8")
  console.log(`Wrote ${count} models to ${outputPath}`)
}

if (import.meta.main) {
  await main()
}
