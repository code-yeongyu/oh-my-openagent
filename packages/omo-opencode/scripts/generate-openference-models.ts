#!/usr/bin/env bun
// Generates src/features/openference-provider/openference-models.json.
//
// Openference (https://api.openference.com) serves an OpenAI-compatible catalog at
// GET /v1/models. Unlike OpenGateway, the listing carries the metadata opencode's
// provider config needs directly: per-token pricing (OpenRouter shape, as USD
// strings), context_length, max_output_tokens, input/output modalities, tool and
// vision capabilities, and reasoning metadata. No enrichment source is required.
//
// Catalog gates (mirrors the OpenGateway generator's policy):
// - text-output models only: image/video generation models are out of scope for
//   chat completions;
// - tool capability is a positive requirement: the harness only routes to models
//   that can call tools;
// - both context_length and max_output_tokens must be published: the docs state
//   either field may be absent, and an unpublished output limit must not be
//   guessed (an over-large limit.output can make requests fail upstream).
//
// Usage: bun run packages/omo-opencode/scripts/generate-openference-models.ts

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

const OPENFERENCE_MODELS_URL = "https://api.openference.com/v1/models"

/** Per-token price strings are converted to per-million-token numbers. */
const PER_TOKEN_TO_PER_MILLION = 1_000_000
/** Rounds away float dust introduced by the per-token to per-million conversion. */
const COST_DECIMALS = 4

export interface OpenferenceCatalogModel {
  readonly id: string
  readonly display_name?: string
  readonly context_length?: number
  readonly max_output_tokens?: number
  readonly input_modalities?: readonly string[]
  readonly output_modalities?: readonly string[]
  readonly capabilities?: {
    readonly tool_calling?: boolean
    readonly vision?: boolean
    readonly attachment?: boolean
  }
  readonly pricing?: {
    readonly prompt?: string
    readonly completion?: string
    readonly cache_read?: string
  }
  readonly reasoning?: { readonly supported?: boolean }
}

export interface OpenferenceCatalogResponse {
  readonly data?: readonly OpenferenceCatalogModel[]
}

/** opencode custom-provider model config entry. */
export interface OpenferenceModelEntry {
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

export type OpenferenceCatalog = Readonly<Record<string, OpenferenceModelEntry>>

/** Converts an OpenRouter-shape per-token price string to a per-million number. */
function perMillion(price: string | undefined): number {
  if (price === undefined) return 0
  const value = Number.parseFloat(price) * PER_TOKEN_TO_PER_MILLION
  const factor = 10 ** COST_DECIMALS
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
}

function toEntry(item: OpenferenceCatalogModel): OpenferenceModelEntry {
  const input = [...(item.input_modalities ?? ["text"])]
  return {
    name: item.display_name ?? item.id,
    reasoning: item.reasoning?.supported === true,
    tool_call: true,
    attachment: input.includes("image"),
    modalities: { input, output: ["text"] },
    cost: {
      input: perMillion(item.pricing?.prompt),
      output: perMillion(item.pricing?.completion),
      cache_read: perMillion(item.pricing?.cache_read),
      // Openference does not publish cache-write pricing; the field stays at the
      // zero default rather than borrowing the input rate.
      cache_write: 0,
    },
    limit: {
      context: item.context_length ?? 0,
      output: item.max_output_tokens ?? 0,
    },
  }
}

export function buildOpenferenceCatalog(response: OpenferenceCatalogResponse): OpenferenceCatalog {
  const catalog: Record<string, OpenferenceModelEntry> = {}

  for (const item of response.data ?? []) {
    // The catalog covers chat-completions models only; image- and
    // video-generation models are served by other endpoints.
    if (item.output_modalities?.includes("text") !== true) continue
    // Tool capability is a positive requirement: the harness only routes to
    // models that can call tools.
    if (item.capabilities?.tool_calling !== true) continue
    // Both limits must be published: an unpublished output limit cannot be
    // guessed safely for opencode's limit.output field.
    if (item.context_length === undefined || item.context_length <= 0) continue
    if (item.max_output_tokens === undefined || item.max_output_tokens <= 0) continue

    catalog[item.id] = toEntry(item)
  }

  return catalog
}

export function serializeOpenferenceCatalog(catalog: OpenferenceCatalog): string {
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return `${JSON.stringify(sorted, undefined, 2)}\n`
}

async function main(): Promise<void> {
  const response = await fetch(OPENFERENCE_MODELS_URL, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`${OPENFERENCE_MODELS_URL} returned HTTP ${response.status}`)
  const catalog = buildOpenferenceCatalog((await response.json()) as OpenferenceCatalogResponse)
  const count = Object.keys(catalog).length
  if (count === 0) throw new Error("Openference catalog came back empty; refusing to overwrite the checked-in JSON")

  const outputPath = join(import.meta.dir, "../src/features/openference-provider/openference-models.json")
  await writeFile(outputPath, serializeOpenferenceCatalog(catalog), "utf8")
  console.log(`Wrote ${count} models to ${outputPath}`)
}

if (import.meta.main) {
  await main()
}
