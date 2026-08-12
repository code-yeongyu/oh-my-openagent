import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { MemoryBlockCache, hashMemoryTemplate } from "./cache"
import { existsSync, readdirSync, realpathSync } from "node:fs"

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

  it("#given either template content or HEAD changes #when compiled #then each logical session key retains only its latest variant", async () => {
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
    expect(cache.size).toBe(2)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given one session at a nudged threshold #when 100 changing nudge variants compile #then replacement keeps the cache bounded to one entry", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new MemoryBlockCache()

    // when
    for (let nudgeTurns = 2; nudgeTurns < 102; nudgeTurns += 1) {
      try {
        await cache.compile(repo, "template", {
          agentId: "cache-agent",
          conversationId: "one-session",
          previousMessageCount: nudgeTurns,
          nudgeTurns,
        })
      } catch (error) {
        // The windows runner fails this loop with a bare exit-1 git error and no stderr; surface
        // the repository state at the failure point so the cause is visible in CI logs.
        const dotGit = join(repo.dir, ".git")
        const objects = join(dotGit, "objects")
        const state = {
          nudgeTurns,
          dotGit: existsSync(dotGit),
          objects: existsSync(objects) ? readdirSync(objects) : null,
          headProbe: await repo.head().catch((probeError: unknown) => String(probeError)),
        }
        throw new Error(`compile failed at iteration ${nudgeTurns}: ${JSON.stringify(state)}`, { cause: error })
      }
    }

    // then
    expect(cache.size).toBe(1)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given a consumed soul notice at an unchanged HEAD #when compiled again #then the notice variant is replaced and the line is gone", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new MemoryBlockCache()
    const base = {
      agentId: "cache-agent",
      conversationId: "soul-session",
      previousMessageCount: 1,
    }

    // when
    const noticed = await cache.compile(repo, "template", {
      ...base,
      soulNotice: { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" },
    })
    const quiet = await cache.compile(repo, "template", base)
    const quietAgain = await cache.compile(repo, "template", base)

    // then
    expect(noticed).not.toBe(quiet)
    expect(quietAgain).toBe(quiet)
    expect(cache.size).toBe(1)
  })

  it("#given template content #when hashed #then the structure version participates in sha256", () => {
    // given / when / then
    expect(hashMemoryTemplate("template")).toMatch(/^[0-9a-f]{64}$/)
    expect(hashMemoryTemplate("template")).not.toBe(hashMemoryTemplate("template changed"))
  })
})
