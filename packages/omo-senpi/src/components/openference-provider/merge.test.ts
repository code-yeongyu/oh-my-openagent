/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  mergeOpenferenceProvider,
  OPENFERENCE_BASE_URL,
  OPENFERENCE_ENV_VAR,
  OPENFERENCE_PROVIDER_ID,
  OPENFERENCE_USER_AGENT,
} from "./merge"
import type { OpenferenceSenpiCatalog } from "./types"

const catalog: OpenferenceSenpiCatalog = [
  {
    id: "GLM-5.2",
    name: "GLM-5.2",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 128000,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
    thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: null },
  },
  {
    id: "Auto",
    name: "Auto",
    reasoning: true,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 131072,
    cost: { input: 0.35, output: 1, cacheRead: 0, cacheWrite: 0 },
  },
]

function defaultBlock(): Record<string, unknown> {
  return {
    baseUrl: OPENFERENCE_BASE_URL,
    api: "openai-completions",
    apiKey: `$${OPENFERENCE_ENV_VAR}`,
    headers: { "User-Agent": OPENFERENCE_USER_AGENT },
    models: catalog.map((entry) => structuredClone(entry)),
  }
}

describe("mergeOpenferenceProvider", () => {
  test("creates the full provider block when no models.json exists", () => {
    // given no existing document
    // when the merge runs
    const result = mergeOpenferenceProvider(undefined, catalog)

    // then the document carries the complete default block
    expect(result?.changed).toBe(true)
    expect(result?.doc).toEqual({ providers: { [OPENFERENCE_PROVIDER_ID]: defaultBlock() } })
  })

  test("adds openference beside an existing unrelated provider without touching it", () => {
    // given a models.json holding only an openai provider
    const openai = { baseUrl: "https://api.openai.com/v1", api: "openai-completions" }
    // when the merge runs
    const result = mergeOpenferenceProvider({ providers: { openai } }, catalog)

    // then both providers are present and the openai block is verbatim
    const providers = result?.doc.providers as Record<string, unknown>
    expect(providers.openai).toEqual(openai)
    expect(providers[OPENFERENCE_PROVIDER_ID]).toEqual(defaultBlock())
  })

  test("fills only the missing fields of a user-authored openference block", () => {
    // given a user block with a custom baseUrl and one custom header
    const existing = {
      providers: {
        [OPENFERENCE_PROVIDER_ID]: {
          baseUrl: "https://proxy.internal/v1",
          headers: { "X-Custom": "kept" },
        },
      },
    }

    // when the merge runs
    const result = mergeOpenferenceProvider(existing, catalog)

    // then the user values survive and only the gaps are filled
    const provider = (result?.doc.providers as Record<string, Record<string, unknown>>)[
      OPENFERENCE_PROVIDER_ID
    ]
    expect(provider.baseUrl).toBe("https://proxy.internal/v1")
    expect(provider.api).toBe("openai-completions")
    expect(provider.apiKey).toBe(`$${OPENFERENCE_ENV_VAR}`)
    expect(provider.headers).toEqual({ "X-Custom": "kept", "User-Agent": OPENFERENCE_USER_AGENT })
    expect(provider.models).toEqual(catalog.map((entry) => structuredClone(entry)))
  })

  test("keeps user model entries and appends only catalog ids they lack", () => {
    // given a user block pinning GLM-5.2 to a trimmed entry
    const existing = {
      providers: {
        [OPENFERENCE_PROVIDER_ID]: {
          models: [{ id: "GLM-5.2", name: "Pinned", contextWindow: 1234, maxTokens: 56 }],
        },
      },
    }

    // when the merge runs
    const result = mergeOpenferenceProvider(existing, catalog)

    // then the user entry stays verbatim and only Auto is appended
    const models = (
      (result?.doc.providers as Record<string, Record<string, unknown>>)[OPENFERENCE_PROVIDER_ID]
        .models as Record<string, unknown>[]
    ).map((entry) => entry.id)
    expect(models).toEqual(["GLM-5.2", "Auto"])
    const glm = ((result?.doc.providers as Record<string, Record<string, unknown>>)[
      OPENFERENCE_PROVIDER_ID
    ].models as Record<string, unknown>[])[0]
    expect(glm).toEqual({ id: "GLM-5.2", name: "Pinned", contextWindow: 1234, maxTokens: 56 })
  })

  test("reports changed false for an already complete block", () => {
    // given a document already carrying the full default block
    const existing = { providers: { [OPENFERENCE_PROVIDER_ID]: defaultBlock() } }

    // when the merge runs
    const result = mergeOpenferenceProvider(existing, catalog)

    // then nothing changed so the caller leaves the file untouched
    expect(result?.changed).toBe(false)
    expect(result?.doc).toEqual(existing)
  })

  test("aborts on incompatible existing shapes instead of rewriting user config", () => {
    // given documents whose openference-relevant slots hold incompatible shapes
    const arrayDoc: unknown = ["providers"]
    const stringDoc: unknown = "not json config"
    const stringProviders: unknown = { providers: "nope" }
    const scalarProvider: unknown = { providers: { [OPENFERENCE_PROVIDER_ID]: 7 } }
    const objectModels: unknown = {
      providers: { [OPENFERENCE_PROVIDER_ID]: { models: { GLM: "yes" } } },
    }

    // when the merge runs
    // then each aborts with undefined
    expect(mergeOpenferenceProvider(arrayDoc, catalog)).toBeUndefined()
    expect(mergeOpenferenceProvider(stringDoc, catalog)).toBeUndefined()
    expect(mergeOpenferenceProvider(stringProviders, catalog)).toBeUndefined()
    expect(mergeOpenferenceProvider(scalarProvider, catalog)).toBeUndefined()
    expect(mergeOpenferenceProvider(objectModels, catalog)).toBeUndefined()
  })
})
