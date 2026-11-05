/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJsonFileCacheStore } from "./json-file-cache-store"
import { createModelCapabilitiesCacheStore } from "./model-capabilities-cache"

// Comparing the whole serialized snapshot is not enough: generatedAt changes
// on every fetch, so an unchanged catalog would still be rewritten.

const catalog = (limit: number) => ({
  provider: { models: { "model-a": { id: "model-a", reasoning: true, limit: { context: limit } } } },
})
const respond = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe("model capabilities cache with an unchanged catalog", () => {
  let cacheDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "omo-caps-"))
  })

  afterEach(() => {
    setSystemTime()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  test("a second fetch of the same catalog does not rewrite the cache file", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    const file = join(cacheDir, "model-capabilities.json")
    const first = await createModelCapabilitiesCacheStore(() => cacheDir).refreshModelCapabilitiesCache({
      fetchImpl: respond(catalog(1000)),
    })
    const written = readFileSync(file, "utf8")
    expect(JSON.parse(written).generatedAt).toBe(first.generatedAt)

    setSystemTime(new Date("2026-01-01T00:00:01.000Z"))
    // A new store stands for another plugin instance or the next process.
    const store = createModelCapabilitiesCacheStore(() => cacheDir)
    const second = await store.refreshModelCapabilitiesCache({ fetchImpl: respond(catalog(1000)) })
    expect(second.generatedAt).not.toBe(first.generatedAt)
    expect(second.models).toEqual(first.models)
    expect(readFileSync(file, "utf8")).toBe(written)
    expect(store.readModelCapabilitiesCache()?.models).toEqual(first.models)

    await store.refreshModelCapabilitiesCache({ fetchImpl: respond(catalog(2000)) })
    const rewritten = readFileSync(file, "utf8")
    expect(rewritten).not.toBe(written)
    expect(JSON.parse(rewritten).models["model-a"].limit.context).toBe(2000)
  })

  test("writeIfChanged without a comparable still compares the whole serialized value", () => {
    const store = createJsonFileCacheStore<{ stamp: number; value: string }>({
      getCacheDir: () => cacheDir,
      filename: "plain.json",
      logPrefix: "test",
      cacheLabel: "Cache",
      describe: () => ({}),
    })
    expect(store.writeIfChanged({ stamp: 1, value: "same" })).toBe(true)
    expect(store.writeIfChanged({ stamp: 1, value: "same" })).toBe(false)
    expect(store.writeIfChanged({ stamp: 2, value: "same" })).toBe(true)
  })

  test("writeIfChanged with a comparable ignores the excluded field and survives a corrupt file", () => {
    const store = createJsonFileCacheStore<{ stamp: number; value: string }>({
      getCacheDir: () => cacheDir,
      filename: "comparable.json",
      logPrefix: "test",
      cacheLabel: "Cache",
      describe: () => ({}),
      comparable: ({ stamp: _stamp, ...rest }) => rest,
    })
    expect(store.writeIfChanged({ stamp: 1, value: "same" })).toBe(true)
    expect(store.writeIfChanged({ stamp: 2, value: "same" })).toBe(false)
    expect(JSON.parse(readFileSync(join(cacheDir, "comparable.json"), "utf8")).stamp).toBe(1)
    expect(store.writeIfChanged({ stamp: 3, value: "changed" })).toBe(true)

    writeFileSync(join(cacheDir, "comparable.json"), "{ not json")
    expect(store.writeIfChanged({ stamp: 4, value: "changed" })).toBe(true)
    expect(JSON.parse(readFileSync(join(cacheDir, "comparable.json"), "utf8")).stamp).toBe(4)
  })
})
