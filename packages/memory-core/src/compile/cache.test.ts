import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { MemoryBlockCache, hashMemoryTemplate } from "./cache"

const tempDirs: string[] = []
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

async function createRepo() {
  const dir = await mkdtemp(join(tmpdir(), "memory-cache-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "cache-agent" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nfirst\n" }] })
  return { dir, repo }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("MemoryBlockCache", () => {
  it("#given the same template and HEAD #when compiled twice #then the cached block and timestamp are reused", async () => {
    // given
    const { repo } = await createRepo()
    let ticks = 0
    const cache = new MemoryBlockCache()
    const options = {
      agentId: "cache-agent",
      conversationId: "cache-conversation",
      previousMessageCount: 1,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ticks++)),
    }

    // when
    const first = await cache.compile(repo, "raw prompt {CORE_MEMORY}", options)
    const second = await cache.compile(repo, "raw prompt {CORE_MEMORY}", options)

    // then
    expect(second).toBe(first)
    expect(ticks).toBe(1)
    expect(cache.size).toBe(1)
  })

  it("#given either template content or HEAD changes #when compiled #then a fresh cache entry is produced", async () => {
    // given
    const { dir, repo } = await createRepo()
    let ticks = 0
    const cache = new MemoryBlockCache()
    const options = {
      agentId: "cache-agent",
      conversationId: "cache-conversation",
      previousMessageCount: 1,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ticks++)),
    }
    const first = await cache.compile(repo, "template-a", options)

    // when
    const templateChanged = await cache.compile(repo, "template-b", options)
    await writeFile(join(dir, "system/persona.md"), "---\ndescription: Persona\n---\nsecond\n")
    await repo.commitWrite(["system/persona.md"], "change persona", {
      agentId: "cache-agent",
      authorName: "Cache Agent",
    })
    const headChanged = await cache.compile(repo, "template-b", options)

    // then
    expect(templateChanged).not.toBe(first)
    expect(headChanged).not.toBe(templateChanged)
    expect(headChanged).toContain("second")
    expect(ticks).toBe(3)
    expect(cache.size).toBe(3)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given template content #when hashed #then the structure version participates in sha256", () => {
    // given / when / then
    expect(hashMemoryTemplate("template")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashMemoryTemplate("template")).not.toBe(hashMemoryTemplate("template changed"))
  })
})
