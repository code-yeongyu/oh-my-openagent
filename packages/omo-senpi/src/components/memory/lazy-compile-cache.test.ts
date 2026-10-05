import { describe, expect, test } from "bun:test"
import { createLazyMemoryCompileCache } from "./lazy-compile-cache"
import { fixture, IDENTITY } from "./prompt.test-support"

describe("lazy prompt cache generations", () => {
  test("#given a cold cache #when a compile starts before clear #then old completion does not repopulate the new generation", async () => {
    const { repo } = await fixture()
    const cache = createLazyMemoryCompileCache()
    expect(cache.size).toBe(0)
    cache.clear()
    const revision = await repo.head()
    const old = cache.compile(repo, "first", { agentId: IDENTITY }, revision)
    cache.clear()
    const fresh = cache.compile(repo, "fresh", { agentId: IDENTITY }, revision)
    expect(await fresh).toBe(await old)
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
    const next = await cache.compile(repo, "next", { agentId: IDENTITY }, revision)
    expect(next).toBe(await fresh)
    expect(cache.size).toBe(1)
  }, 30_000)
})
