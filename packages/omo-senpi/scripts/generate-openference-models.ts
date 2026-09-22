#!/usr/bin/env bun
// Generates src/components/openference-provider/openference-senpi-models.json.
//
// Openference (https://api.openference.com) serves an OpenAI-compatible catalog at
// GET /v1/models carrying per-token pricing (OpenRouter-shape USD strings),
// context_length, max_output_tokens, input/output modalities, tool/vision
// capabilities, and reasoning metadata. This generator maps that listing onto
// the Pi models.json model-entry shape (packages/omo-senpi engine docs:
// docs/models.md) consumed by the openference-provider component.
//
// Catalog gates (mirror packages/omo-opencode/scripts/generate-opengateway-models.ts):
// - text-output models only: image/video generation models are out of scope for
//   chat completions;
// - tool capability is a positive requirement: the harness only routes to models
//   that can call tools;
// - both context_length and max_output_tokens must be published: Pi falls back to
//   a 128000 context window and a 16384 output cap when they are omitted, which
//   compacts sessions far below what these models support.
//
// Field mapping notes:
// - cost is per-million (Pi shape: input/output/cacheRead/cacheWrite) converted
//   from the listing's per-token strings; Openference publishes no cache-write
//   rate, so cacheWrite stays at the zero default rather than borrowing input.
// - input maps to Pi's supported ["text"] / ["text", "image"]; other input
//   modalities (video) are dropped.
// - thinkingLevelMap is emitted only for models whose reasoning.control is
//   "effort" (map each Senpi level to the published effort or null) or
//   "always_on" ({ off: null }); toggle/adaptive controls use Pi's default
//   mapping and omit the field.
//
// Usage: bun run packages/omo-senpi/scripts/generate-openference-models.ts

import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai"

import type {
  OpenferenceSenpiCatalog,
  OpenferenceSenpiModelEntry,
} from "../src/components/openference-provider/types"

export type { OpenferenceSenpiCatalog, OpenferenceSenpiModelEntry }

const OPENFERENCE_MODELS_URL = "https://api.openference.com/v1/models"

/** Per-token price strings are converted to per-million-token numbers. */
const PER_TOKEN_TO_PER_MILLION = 1_000_000
/** Rounds away float dust introduced by the per-token to per-million conversion. */
const COST_DECIMALS = 4

/** Senpi thinking levels that map onto published provider effort words. */
const SENPI_EFFORT_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"]

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
  readonly reasoning?: {
    readonly supported?: boolean
    readonly control?: string
    readonly supported_efforts?: readonly string[]
  }
}

export interface OpenferenceCatalogResponse {
  readonly data?: readonly OpenferenceCatalogModel[]
}

/** Converts an OpenRouter-shape per-token price string to a per-million number. */
function perMillion(price: string | undefined): number {
  if (price === undefined) return 0
  const value = Number.parseFloat(price) * PER_TOKEN_TO_PER_MILLION
  const factor = 10 ** COST_DECIMALS
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
}

function thinkingLevelMap(model: OpenferenceCatalogModel): ThinkingLevelMap | undefined {
  const reasoning = model.reasoning
  if (reasoning?.control === "always_on") {
    // Reasoning is always emitted: there is no off switch, so the off level is
    // unsupported while the standard levels keep the provider's default mapping.
    return { off: null }
  }
  if (reasoning?.control !== "effort") return undefined
  const efforts = reasoning.supported_efforts
  if (efforts === undefined || efforts.length === 0) return undefined
  const map: ThinkingLevelMap = {}
  for (const level of SENPI_EFFORT_LEVELS) {
    map[level] = efforts.includes(level) ? level : null
  }
  // "off" stays omitted: effort-controlled Openference models also accept the
  // on/off toggle, so the default off handling remains correct.
  return map
}

function toEntry(item: OpenferenceCatalogModel): OpenferenceSenpiModelEntry {
  const input: ["text"] | ["text", "image"] = item.input_modalities?.includes("image") === true
    ? ["text", "image"]
    : ["text"]
  const levels = thinkingLevelMap(item)
  return {
    id: item.id,
    name: item.display_name ?? item.id,
    reasoning: item.reasoning?.supported === true,
    input,
    contextWindow: item.context_length ?? 0,
    maxTokens: item.max_output_tokens ?? 0,
    cost: {
      input: perMillion(item.pricing?.prompt),
      output: perMillion(item.pricing?.completion),
      cacheRead: perMillion(item.pricing?.cache_read),
      // Openference does not publish cache-write pricing; the field stays at the
      // zero default rather than borrowing the input rate.
      cacheWrite: 0,
    },
    ...(levels === undefined ? {} : { thinkingLevelMap: levels }),
  }
}

export function buildOpenferenceSenpiCatalog(response: OpenferenceCatalogResponse): OpenferenceSenpiCatalog {
  const catalog: OpenferenceSenpiModelEntry[] = []

  for (const item of response.data ?? []) {
    // The catalog covers chat-completions models only; image- and
    // video-generation models are served by other endpoints.
    if (item.output_modalities?.includes("text") !== true) continue
    // Tool capability is a positive requirement: the harness only routes to
    // models that can call tools.
    if (item.capabilities?.tool_calling !== true) continue
    // Both limits must be published: Pi's fallbacks (128000 context, 16384
    // output) are far below these models' real windows.
    if (item.context_length === undefined || item.context_length <= 0) continue
    if (item.max_output_tokens === undefined || item.max_output_tokens <= 0) continue

    catalog.push(toEntry(item))
  }

  return catalog.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function serializeOpenferenceSenpiCatalog(catalog: OpenferenceSenpiCatalog): string {
  return `${JSON.stringify(catalog, undefined, 2)}\n`
}

async function main(): Promise<void> {
  const response = await fetch(OPENFERENCE_MODELS_URL, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`${OPENFERENCE_MODELS_URL} returned HTTP ${response.status}`)
  const catalog = buildOpenferenceSenpiCatalog((await response.json()) as OpenferenceCatalogResponse)
  if (catalog.length === 0) throw new Error("Openference catalog came back empty; refusing to overwrite the checked-in JSON")

  const outputPath = join(
    import.meta.dir,
    "../src/components/openference-provider/openference-senpi-models.json",
  )
  await writeFile(outputPath, serializeOpenferenceSenpiCatalog(catalog), "utf8")
  console.log(`Wrote ${catalog.length} models to ${outputPath}`)
}

if (import.meta.main) {
  await main()
}
