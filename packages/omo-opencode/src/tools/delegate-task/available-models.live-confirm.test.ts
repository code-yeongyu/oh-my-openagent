/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { confirmRequestedModels } from "./available-models"
import { resolveCategoryExecution } from "./category-resolver"
import { resolveSubagentModel } from "./subagent-model-resolution"
import {
  _resetMemCacheForTesting,
  readProviderModelsCache,
  writeProviderModelsCache,
} from "../../shared/connected-providers-cache"
import { getOmoOpenCodeCacheDir } from "../../shared/data-path"

const originalCacheHome = process.env.XDG_CACHE_HOME
let cacheHome: string | undefined

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "delegate-live-confirm-"))
  process.env.XDG_CACHE_HOME = cacheHome
  _resetMemCacheForTesting()
})

afterEach(() => {
  _resetMemCacheForTesting()
  if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalCacheHome
  if (cacheHome) rmSync(cacheHome, { recursive: true, force: true })
  cacheHome = undefined
})

const client = (rows: Array<{ provider: string; id: string }>, calls: { n: number }) =>
  ({
    model: {
      list: async () => {
        calls.n++
        return { data: rows }
      },
    },
  }) as never

describe("a partial cached catalog does not hide a requested model", () => {
  const cached = new Set(["fixture/model-a", "fixture/model-b", "fixture/model-c"])

  test("a requested model the cache lacks is confirmed against the live catalog", async () => {
    const calls = { n: 0 }
    const out = await confirmRequestedModels(
      client(
        [
          { provider: "fixture", id: "model-d" },
          { provider: "other", id: "x" },
        ],
        calls,
      ),
      cached,
      ["fixture/model-d"],
    )
    expect(out.has("fixture/model-d")).toBe(true)
    expect(out.has("other/x")).toBe(false)
    expect(calls.n).toBe(1)
  })

  test("a model the live catalog also lacks stays missing (fallback still applies)", async () => {
    const calls = { n: 0 }
    const out = await confirmRequestedModels(client([{ provider: "fixture", id: "model-a" }], calls), cached, [
      "fixture/model-z",
    ])
    expect(out.has("fixture/model-z")).toBe(false)
    expect(calls.n).toBe(1)
  })

  test("no live read when the requested model is cached, absent, or on a provider the cache does not serve", async () => {
    const calls = { n: 0 }
    const live = client([{ provider: "fixture", id: "model-d" }], calls)
    expect(await confirmRequestedModels(live, cached, ["fixture/model-b"])).toBe(cached)
    expect(await confirmRequestedModels(live, cached, [undefined])).toBe(cached)
    expect(await confirmRequestedModels(live, cached, ["elsewhere/model-d"])).toBe(cached)
    expect(calls.n).toBe(0)
  })

  test("a failing live read keeps the cached catalog", async () => {
    const failing = {
      model: {
        list: async () => {
          throw new Error("offline")
        },
      },
    } as never
    expect(await confirmRequestedModels(failing, cached, ["fixture/model-d"])).toBe(cached)
  })
})

type ResolutionPath = "category" | "subagent"

function resolutionFixture(rows: Array<{ provider: string; id: string }>, fail = false) {
  const metadata = { id: "model-a", name: "Keep this metadata", limit: { context: 200_000, output: 4096 } }
  const other = [{ id: "keep-other", limit: { context: 100_000 } }]
  writeProviderModelsCache({
    models: { fixture: [metadata, { id: "model-b" }, { id: "model-c" }], other },
    connected: ["fixture", "other"],
  })
  const cacheFile = join(getOmoOpenCodeCacheDir(), "provider-models.json")
  const before = readFileSync(cacheFile, "utf8")
  const calls = { n: 0 }
  const core = {
    model: {
      list: async () => {
        calls.n++
        if (fail) throw new Error("catalog offline")
        return { data: rows }
      },
    },
  }
  const resolve = async (path: ResolutionPath, requested = "fixture/model-d") => {
    const configured = { model: requested, variant: "high", fallback_models: ["fixture/model-c"] }
    if (path === "category") {
      return resolveCategoryExecution(
        { category: "unspecified-high" } as never,
        { client: core, userCategories: { "unspecified-high": configured } } as never,
        undefined,
        undefined,
      )
    }
    return resolveSubagentModel(
      "explore",
      { name: "explore", model: { providerID: "fixture", modelID: "model-b" } } as never,
      { client: core, agentOverrides: { explore: configured } } as never,
    )
  }
  return { metadata, other, core, calls, cacheFile, before, resolve }
}

describe("live confirmation through production delegate resolution", () => {
  for (const path of ["category", "subagent"] as const) {
    test(`${path}: an exact live hit is used and persisted, so the next resolution needs no live read`, async () => {
      const fixture = resolutionFixture([
        { provider: "fixture", id: "model-d" },
        { provider: "unconnected", id: "model-new" },
      ])

      const first = await fixture.resolve(path)
      expect(first.categoryModel).toMatchObject({ providerID: "fixture", modelID: "model-d", variant: "high" })
      expect(first.fallbackChain).toEqual([{ providers: ["fixture"], model: "model-c" }])
      expect(fixture.calls.n).toBe(1)

      // Exercise the real file-backed cache and a cold in-memory read, not just the helper's returned Set.
      _resetMemCacheForTesting()
      const cache = readProviderModelsCache()
      expect(cache?.models.fixture).toContainEqual({ id: "model-d" })
      expect(cache?.models.fixture[0]).toEqual(fixture.metadata)
      expect(cache?.models.other).toEqual(fixture.other)
      expect(cache?.connected).toEqual(["fixture", "other"])
      expect(cache?.models.unconnected).toBeUndefined()

      const second = await fixture.resolve(path)
      expect(second.categoryModel?.modelID).toBe("model-d")
      expect(fixture.calls.n).toBe(1)
    })

    test(`${path}: a live miss keeps fallback and does not rewrite the cache`, async () => {
      const fixture = resolutionFixture([{ provider: "fixture", id: "model-c" }])
      const result = await fixture.resolve(path)
      expect(result.categoryModel?.modelID).toBe("model-c")
      expect(fixture.calls.n).toBe(1)
      expect(readFileSync(fixture.cacheFile, "utf8")).toBe(fixture.before)
    })

    test(`${path}: a failed live read keeps fallback and does not rewrite the cache`, async () => {
      const fixture = resolutionFixture([], true)
      const result = await fixture.resolve(path)
      expect(result.categoryModel?.modelID).toBe("model-c")
      expect(fixture.calls.n).toBe(1)
      expect(readFileSync(fixture.cacheFile, "utf8")).toBe(fixture.before)
    })

    test(`${path}: absent providers keep existing fallback without a live read or cache rewrite`, async () => {
      const fixture = resolutionFixture([{ provider: "unconnected", id: "model-d" }])
      const result = await fixture.resolve(path, "unconnected/model-d")
      expect(result.categoryModel?.modelID).toBe("model-c")
      expect(fixture.calls.n).toBe(0)
      expect(readFileSync(fixture.cacheFile, "utf8")).toBe(fixture.before)
    })

    test(`${path}: a variant-qualified request refreshes the base model ID only`, async () => {
      const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
      const result = await fixture.resolve(path, "fixture/model-d(high)")
      expect(result.categoryModel).toMatchObject({ providerID: "fixture", modelID: "model-d", variant: "high" })
      expect(readProviderModelsCache()?.models.fixture).toContainEqual({ id: "model-d" })
      const next = await fixture.resolve(path, "fixture/model-d(high)")
      expect(next.categoryModel?.modelID).toBe("model-d")
      expect(fixture.calls.n).toBe(1)
    })
  }

  test("category: a configured chain confirms its primary before the availability gate rejects it", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
    const result = await resolveCategoryExecution(
      { category: "unspecified-high" } as never,
      { client: fixture.core, userCategories: { "unspecified-high": { models: ["fixture/model-d"] } } } as never,
      undefined,
      undefined,
    )
    expect(result.error).toBeUndefined()
    expect(result.categoryModel?.modelID).toBe("model-d")
    expect(fixture.calls.n).toBe(1)
    expect(readProviderModelsCache()?.models.fixture).toContainEqual({ id: "model-d" })
  })

  test("category: a configured chain that also misses live remains an availability error", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-c" }])
    const result = await resolveCategoryExecution(
      { category: "unspecified-high" } as never,
      { client: fixture.core, userCategories: { "unspecified-high": { models: ["fixture/model-d"] } } } as never,
      undefined,
      undefined,
    )
    expect(result.error).toContain("Configured model chain is unavailable")
    expect(result.categoryModel).toBeUndefined()
    expect(fixture.calls.n).toBe(1)
    expect(readFileSync(fixture.cacheFile, "utf8")).toBe(fixture.before)
  })

  test("category: one live read also confirms a later explicit chain entry without caching a missing primary", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
    const result = await resolveCategoryExecution(
      { category: "unspecified-high" } as never,
      {
        client: fixture.core,
        userCategories: { "unspecified-high": { models: ["fixture/model-z", "fixture/model-d"] } },
      } as never,
      undefined,
      undefined,
    )
    expect(result.error).toBeUndefined()
    expect(result.categoryModel?.modelID).toBe("model-d")
    expect(fixture.calls.n).toBe(1)
    expect(readProviderModelsCache()?.models.fixture).toContainEqual({ id: "model-d" })
    expect(readProviderModelsCache()?.models.fixture).not.toContainEqual({ id: "model-z" })
  })

  test("a targeted refresh preserves the legacy string cache representation", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
    writeProviderModelsCache({ models: { fixture: ["model-a", "model-b", "model-c"] }, connected: ["fixture"] })
    const result = await fixture.resolve("subagent")
    expect(result.categoryModel?.modelID).toBe("model-d")
    _resetMemCacheForTesting()
    expect(readProviderModelsCache()?.models.fixture).toEqual(["model-a", "model-b", "model-c", "model-d"])
  })

  test("a targeted refresh merges into a cache updated while the live read was in flight", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
    const list = fixture.core.model.list
    fixture.core.model.list = async () => {
      const result = await list()
      writeProviderModelsCache({
        models: {
          fixture: [fixture.metadata, { id: "model-c" }, { id: "model-e", name: "Arrived during read" }],
          other: fixture.other,
        },
        connected: ["fixture", "other"],
      })
      return result
    }
    const result = await fixture.resolve("category")
    expect(result.categoryModel?.modelID).toBe("model-d")
    expect(fixture.calls.n).toBe(1)
    expect(readProviderModelsCache()?.models.fixture).toContainEqual({ id: "model-e", name: "Arrived during read" })
    expect(readProviderModelsCache()?.models.fixture).toContainEqual({ id: "model-d" })
  })

  test("a cache write failure does not discard the exact model confirmed live", async () => {
    const fixture = resolutionFixture([{ provider: "fixture", id: "model-d" }])
    // Make just this test's cache file unwritable without platform-specific chmod semantics.
    rmSync(fixture.cacheFile)
    mkdirSync(fixture.cacheFile)
    const result = await fixture.resolve("subagent")
    expect(result.categoryModel?.modelID).toBe("model-d")
    expect(fixture.calls.n).toBe(1)
    expect(readProviderModelsCache()?.models.fixture).not.toContainEqual({ id: "model-d" })
  })
})
