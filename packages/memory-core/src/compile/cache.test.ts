import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, readdirSync, realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { MemoryBlockCache, hashMemoryTemplate } from "./cache"

const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

const tempDirs: string[] = []

async function createRepo() {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-cache-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "cache-agent" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nfirst\n" }] })
  return { dir, repo }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("MemoryBlockCache", () => {
  it("#given the same template identity and HEAD #when compiled twice #then the stable projection is reused", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new MemoryBlockCache()
    const options = { agentId: "cache-agent" }

    // when
    const first = await cache.compile(repo, "raw prompt {CORE_MEMORY}", options)
    const second = await cache.compile(repo, "raw prompt {CORE_MEMORY}", options)

    // then
    expect(second).toBe(first)
    expect(cache.size).toBe(1)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given either template content or HEAD changes #when compiled #then each stable key retains only its latest revision", async () => {
    // given
    const { dir, repo } = await createRepo()
    const cache = new MemoryBlockCache()
    const options = { agentId: "cache-agent" }
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
    expect(templateChanged).toBe(first)
    expect(headChanged).not.toBe(templateChanged)
    expect(headChanged).toContain("second")
    expect(cache.size).toBe(2)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given repeated calls for one stable projection #when compile runs many times #then the cache stays bounded to one entry", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new MemoryBlockCache()

    // when
    for (const iteration of [2, 3, 10, 100]) {
      try {
        await cache.compile(repo, "template", { agentId: "cache-agent" })
      } catch (error) {
        // The windows runner fails this loop with a bare exit-1 git error and no stderr; surface
        // the repository state at the failure point so the cause is visible in CI logs.
        const dotGit = join(repo.dir, ".git")
        const objects = join(dotGit, "objects")
        const state = {
          iteration,
          dotGit: existsSync(dotGit),
          objects: existsSync(objects) ? readdirSync(objects) : null,
          headProbe: await repo.head().catch((probeError: unknown) => String(probeError)),
        }
        throw new Error(`compile failed at iteration ${iteration}: ${JSON.stringify(state)}`, { cause: error })
      }
    }

    // then
    expect(cache.size).toBe(1)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given two identities at the same HEAD #when compiled through one cache #then identity-stable projections remain isolated", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new MemoryBlockCache()

    // when
    const first = await cache.compile(repo, "template", { agentId: "cache-agent" })
    const second = await cache.compile(repo, "template", { agentId: "other-agent" })
    const firstAgain = await cache.compile(repo, "template", { agentId: "cache-agent" })

    // then
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)
    expect(second).toContain("- AGENT_ID: other-agent")
    expect(cache.size).toBe(2)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given template content #when hashed #then the structure version participates in sha256", () => {
    // given / when / then
    expect(hashMemoryTemplate("template")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashMemoryTemplate("template")).not.toBe(hashMemoryTemplate("template changed"))
  })
})
