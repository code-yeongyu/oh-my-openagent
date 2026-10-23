import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, GitTimeoutError } from "../git"
import { withRecallTermSavesExcluded } from "../recall/bm25-persist-gate"
import { MemoryBlockCache } from "./cache"
import { removeTree } from "../../../../test-support/remove-tree"

// Contract: a compiled memory block is a pure function of (revision, template, identity, projection limits), so a
// new process must not list the tree, read blobs or walk history again for a block an earlier process compiled.
// That work is the relaunch cost of the prompt path (about 94 ms warm and 3.5 s on a cold pack, 6.9k notes).

const TEMPLATE = "omo-senpi:before_agent_start:v3:cache-agent"
const OPTIONS = { agentId: "cache-agent" }
const STORE_FILE_PREFIX = "omo-memory-block-"
const tempDirs: string[] = []
const caches: MemoryBlockCache[] = []

afterEach(async () => {
  await Promise.all(caches.splice(0).map((cache) => cache.settled()))
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function createRepo(): Promise<{ dir: string; repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-block-persist-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "cache-agent" })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nsteady\n" },
      { relativePath: "system/human.md", content: "---\ndescription: Human\n---\nprefers short answers\n" },
      { relativePath: "system/agreements.md", content: "---\ndescription: Agreements\n---\n- [global] Reply in English.\n" },
      ...Array.from({ length: 30 }, (_, note) => ({
        relativePath: `reference/topic-${note % 3}/note-${note}.md`,
        content: `---\ndescription: note ${note}\n---\nbody ${note}\n`,
      })),
    ],
  })
  return { dir, repo }
}

interface GitWork {
  lsTree: number
  show: number
  pathCommitTimes: number
}

function counting(repo: GitMemoryRepo): { repo: GitMemoryRepo; work: GitWork } {
  const work: GitWork = { lsTree: 0, show: 0, pathCommitTimes: 0 }
  const proxy = new Proxy(repo, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== "function") return value
      if (property === "lsTree" || property === "show" || property === "pathCommitTimes") {
        return (...args: unknown[]) => {
          work[property] += 1
          return value.apply(target, args)
        }
      }
      return value.bind(target)
    },
  })
  return { repo: proxy, work }
}

const store = () => import("./block-persist")

function tracked(cache: MemoryBlockCache): MemoryBlockCache {
  caches.push(cache)
  return cache
}

function persistedCache(): MemoryBlockCache {
  return tracked(new MemoryBlockCache({ store }))
}

async function settle(cache: MemoryBlockCache): Promise<void> {
  await cache.settled()
}

async function storeFiles(dir: string): Promise<string[]> {
  return (await readdir(join(dir, ".git"))).filter((name) => name.startsWith(STORE_FILE_PREFIX))
}

describe("MemoryBlockCache persisted blocks", () => {
  it("#given a block one process compiled at a revision #when a new process compiles the same revision #then it reads the stored bytes without listing the tree, reading blobs or walking history", async () => {
    // given
    const { repo } = await createRepo()
    const revision = await repo.head()
    const first = persistedCache()
    const compiled = await first.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(first)

    // when
    const next = counting(repo)
    const reread = await persistedCache().compile(next.repo, TEMPLATE, OPTIONS, revision)

    // then
    expect(reread).toBe(compiled)
    expect(next.work).toEqual({ lsTree: 0, show: 0, pathCommitTimes: 0 })
  })

  it("#given a stored block #when the projection limits differ or the revision moved #then the new process compiles and its bytes match an uncached compile", async () => {
    // given
    const { dir, repo } = await createRepo()
    const revision = await repo.head()
    const first = persistedCache()
    await first.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(first)
    const limited = { ...OPTIONS, projection: { maxEntriesPerDirectory: 2, maxBytes: 0 } }
    await writeFile(join(dir, "system", "persona.md"), "---\ndescription: Persona\n---\nchanged\n")
    await repo.commitWrite(["system/persona.md"], "change persona", { agentId: "cache-agent", authorName: "Cache Agent" })
    const moved = await repo.head()

    // when
    const otherLimits = counting(repo)
    const limitedBlock = await persistedCache().compile(otherLimits.repo, TEMPLATE, limited, revision)
    const otherRevision = counting(repo)
    const movedBlock = await persistedCache().compile(otherRevision.repo, TEMPLATE, OPTIONS, moved)

    // then
    expect(otherLimits.work.lsTree).toBeGreaterThan(0)
    expect(limitedBlock).toBe(await new MemoryBlockCache().compile(repo, TEMPLATE, limited, revision))
    expect(otherRevision.work.lsTree).toBeGreaterThan(0)
    expect(movedBlock).toBe(await new MemoryBlockCache().compile(repo, TEMPLATE, OPTIONS, moved))
    expect(movedBlock).toContain("changed")
  })

  it("#given a stored block #when another identity or another build compiles the same revision #then it compiles instead of reading the stored bytes", async () => {
    // given
    const { repo } = await createRepo()
    const revision = await repo.head()
    const first = tracked(new MemoryBlockCache({ store, build: "build-a" }))
    await first.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(first)

    // when
    const otherBuild = counting(repo)
    await tracked(new MemoryBlockCache({ store, build: "build-b" })).compile(otherBuild.repo, TEMPLATE, OPTIONS, revision)
    const otherIdentity = counting(repo)
    await tracked(new MemoryBlockCache({ store, build: "build-a" })).compile(otherIdentity.repo, TEMPLATE, { agentId: "other-agent" }, revision)
    const sameInputs = counting(repo)
    await tracked(new MemoryBlockCache({ store, build: "build-a" })).compile(sameInputs.repo, TEMPLATE, OPTIONS, revision)

    // then
    expect(otherBuild.work.lsTree).toBeGreaterThan(0)
    expect(otherIdentity.work.lsTree).toBeGreaterThan(0)
    expect(sameInputs.work.lsTree).toBe(0)
  })

  it("#given stored blocks #when the repository is inspected #then they live in its git dir and no commit, index entry or status line carries them", async () => {
    // given
    const { dir, repo } = await createRepo()
    const revision = await repo.head()
    const cache = persistedCache()

    // when
    await cache.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(cache)

    // then
    expect((await storeFiles(dir)).length).toBe(1)
    expect(await repo.status()).toBe("")
    expect((await repo.lsTree("HEAD")).some((path) => path.includes(STORE_FILE_PREFIX))).toBe(false)
  })

  it("#given a git read times out during the compile #when the block is compiled #then that turn gets the fallback block, nothing is stored, and a fresh process compiles the full block", async () => {
    for (const failing of ["pathCommitTimes", "show"] as const) {
      // given
      const { dir, repo } = await createRepo()
      const revision = await repo.head()
      const full = await new MemoryBlockCache().compile(repo, TEMPLATE, OPTIONS, revision)
      const flaky = new Proxy(repo, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (typeof value !== "function") return value
          if (property === failing) {
            return (...args: unknown[]) =>
              failing === "show" && args[1] !== "system/persona.md"
                ? value.apply(target, args)
                : Promise.reject(new GitTimeoutError([failing], 1))
          }
          return value.bind(target)
        },
      })
      const degraded = persistedCache()

      // when
      const fallback = await degraded.compile(flaky, TEMPLATE, OPTIONS, revision)
      await settle(degraded)
      const relaunch = counting(repo)
      const recompiled = await persistedCache().compile(relaunch.repo, TEMPLATE, OPTIONS, revision)

      // then
      if (failing === "show") expect(fallback).not.toBe(full)
      expect(await storeFiles(dir), failing).toEqual([])
      expect(relaunch.work.lsTree, failing).toBeGreaterThan(0)
      expect(recompiled, failing).toBe(full)
    }
  })

  it("#given the agreements read times out during the compile #when the block is compiled #then nothing is stored and a fresh process compiles the full block", async () => {
    // given
    const { dir, repo } = await createRepo()
    const revision = await repo.head()
    const full = await new MemoryBlockCache().compile(repo, TEMPLATE, OPTIONS, revision)
    const flaky = new Proxy(repo, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== "function") return value
        if (property === "show") {
          return (...args: unknown[]) =>
            args[1] === "system/agreements.md"
              ? Promise.reject(new GitTimeoutError(["show"], 1))
              : value.apply(target, args)
        }
        return value.bind(target)
      },
    })
    const degraded = persistedCache()

    // when
    const fallback = await degraded.compile(flaky, TEMPLATE, OPTIONS, revision)
    await settle(degraded)
    const recompiled = await persistedCache().compile(repo, TEMPLATE, OPTIONS, revision)

    // then
    expect(fallback).not.toBe(full)
    expect(await storeFiles(dir)).toEqual([])
    expect(recompiled).toBe(full)
  })

  it("#given a damaged stored block #when a new process compiles #then it compiles the correct bytes and rewrites the entry for the next process", async () => {
    // given
    const { dir, repo } = await createRepo()
    const revision = await repo.head()
    const first = persistedCache()
    const compiled = await first.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(first)
    for (const name of await storeFiles(dir)) await writeFile(join(dir, ".git", name), "not a stored block")

    // when
    const repair = persistedCache()
    const repaired = await repair.compile(repo, TEMPLATE, OPTIONS, revision)
    await settle(repair)
    const after = counting(repo)
    const reread = await persistedCache().compile(after.repo, TEMPLATE, OPTIONS, revision)

    // then
    expect(repaired).toBe(compiled)
    expect(reread).toBe(compiled)
    expect(after.work.lsTree).toBe(0)
  })

  it("#given a restore holds the memory repository's exclusive gate #when a block is compiled #then nothing is written into .git", async () => {
    // given
    const { dir, repo } = await createRepo()
    const revision = await repo.head()
    const cache = persistedCache()

    // when
    await withRecallTermSavesExcluded(dir, async () => {
      await cache.compile(repo, TEMPLATE, OPTIONS, revision)
      await settle(cache)
    })
    await settle(cache)

    // then
    expect(await storeFiles(dir)).toEqual([])
  })

  it("#given a store module that never loads #when a block is compiled #then the compile returns the correct bytes instead of waiting on the store", async () => {
    // given
    const { repo } = await createRepo()
    const revision = await repo.head()
    const stalled = new MemoryBlockCache({ store: () => new Promise<never>(() => undefined) })
    const expected = await new MemoryBlockCache().compile(repo, TEMPLATE, OPTIONS, revision)

    // when
    const compiled = await Promise.race([
      stalled.compile(repo, TEMPLATE, OPTIONS, revision),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("compile waited 5 s on a store that never loads")), 5_000)),
    ])

    // then
    expect(compiled).toBe(expected)
  })
})
