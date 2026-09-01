import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, createNodeGitExec, type GitExec } from "../git"
import { buildDefaultSeedFiles } from "../seeds"
import { applyFactsBatch, type FactsBatch } from "./extraction"
import { planFactsMutation } from "./mutation-plan"
import { applyFactsRecovery } from "./recovery"

const AUTHOR = { agentId: "facts-setter-race", authorName: "Facts Setter Race" }
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const tempDirs: string[] = []

setDefaultTimeout(WINDOWS_INTEGRATION_TEST_TIMEOUT)

function batch(batchId = "11111111-1111-4111-8111-111111111111"): FactsBatch {
  return {
    batchId,
    records: [
      { scope: "project", text: "August.", date: "2026-08-10" },
      { scope: "project", text: "September.", date: "2026-09-01" },
    ],
  }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "facts-setter-race-"))
  tempDirs.push(dir)
  const base = createNodeGitExec()
  let injection: (() => Promise<void>) | undefined
  const exec: GitExec = {
    run: async (args, options) => {
      const result = await base.run(args, options)
      if (injection !== undefined && args[0] === "hash-object" && args.includes("--no-filters")) {
        const operation = injection
        injection = undefined
        await operation()
      }
      return result
    },
  }
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId, exec })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  return { dir, repo, injectAfterNextWorktreeHash: (operation: () => Promise<void>) => { injection = operation } }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })))
})

describe("facts conditional mutation primitives", () => {
  test("preserves a foreign replacement injected after hashing an existing tracked path", async () => {
    const { dir, repo, injectAfterNextWorktreeHash } = await fixture()
    await applyFactsBatch(repo, {
      batchId: "11111111-1111-4111-8111-111111111111",
      records: [{ scope: "project", text: "Initial August.", date: "2026-08-01" }],
    }, AUTHOR)
    const recovery = await planFactsMutation(repo, batch("22222222-2222-4222-8222-222222222222"), undefined)
    const august = "notes/facts/2026-08.md"
    const september = "notes/facts/2026-09.md"
    const indexBefore = await repo.pathState.captureAll([august, september])
    const originalWrite = repo.pathState.writeWorktreeIfIdentity.bind(repo.pathState)
    repo.pathState.writeWorktreeIfIdentity = async (path, expected, next) => {
      repo.pathState.writeWorktreeIfIdentity = originalWrite
      injectAfterNextWorktreeHash(() => writeFile(join(dir, august), "foreign existing replacement\n"))
      return originalWrite(path, expected, next)
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    expect(await readFile(join(dir, august), "utf8")).toBe("foreign existing replacement\n")
    expect((await repo.pathState.capture(august)).index).toEqual(indexBefore.get(august)?.index ?? null)
    expect((await repo.pathState.capture(september)).index).toEqual(indexBefore.get(september)?.index ?? null)
    expect(await repo.pathState.capture(september)).toEqual(recovery.paths.find((entry) => entry.path === september)!.pre)
    expect((await repo.log()).some((commit) => commit.trailers["Omo-Facts-Batch"] === recovery.batchId)).toBe(false)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  test("preserves a foreign write injected after deletion reservation resolves", async () => {
    const { dir, repo } = await fixture()
    await applyFactsBatch(repo, {
      batchId: "11111111-1111-4111-8111-111111111111",
      records: [{ scope: "project", text: "Initial August.", date: "2026-08-01" }],
    }, AUTHOR)
    const planned = await planFactsMutation(repo, batch("22222222-2222-4222-8222-222222222222"), undefined)
    const august = "notes/facts/2026-08.md"
    const september = "notes/facts/2026-09.md"
    const currentAugust = await repo.pathState.capture(august)
    if (currentAugust.index === null || currentAugust.worktree.kind !== "file") throw new Error("expected August")
    const recovery = {
      ...planned,
      paths: planned.paths.map((entry) => entry.path === august ? {
        path: august,
        pre: { index: null, worktree: { kind: "missing" as const } },
        post: { index: currentAugust.index!, worktree: currentAugust.worktree as Extract<typeof currentAugust.worktree, { kind: "file" }> },
      } : entry),
    }
    const indexBefore = await repo.pathState.captureAll([august, september])
    let deletionResult: boolean | string | undefined
    const originalReserve = repo.pathState.reserveWorktreeDeletion.bind(repo.pathState)
    repo.pathState.reserveWorktreeDeletion = async (path, moved) => {
      repo.pathState.reserveWorktreeDeletion = originalReserve
      const reservation = await originalReserve(path, moved)
      return reservation === undefined ? undefined : {
        verify: async () => {
          try {
            await writeFile(join(dir, august), "foreign after deletion reservation\n")
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || !["EISDIR", "EEXIST"].includes(String(error.code))) throw error
            await rm(join(dir, august), { recursive: true })
            await writeFile(join(dir, august), "foreign after deletion reservation\n")
          }
          const finalizer = await reservation.verify()
          if (finalizer === undefined) deletionResult = false
          return finalizer
        },
      }
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    expect(deletionResult).toBe(false)
    expect(await readFile(join(dir, august), "utf8")).toBe("foreign after deletion reservation\n")
    expect((await repo.pathState.capture(august)).index).toEqual(indexBefore.get(august)?.index ?? null)
    expect((await repo.pathState.capture(september)).index).toEqual(indexBefore.get(september)?.index ?? null)
    expect(await repo.pathState.capture(september)).toEqual(recovery.paths.find((entry) => entry.path === september)!.pre)
    expect((await repo.log()).some((commit) => commit.trailers["Omo-Facts-Batch"] === recovery.batchId)).toBe(false)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  test("preserves foreign bytes injected after hashing an existing path for deletion", async () => {
    const { dir, repo, injectAfterNextWorktreeHash } = await fixture()
    await applyFactsBatch(repo, {
      batchId: "11111111-1111-4111-8111-111111111111",
      records: [{ scope: "project", text: "Initial August.", date: "2026-08-01" }],
    }, AUTHOR)
    const path = "notes/facts/2026-08.md"
    const before = await repo.pathState.capture(path)
    const expected = before.worktree
    if (expected.kind !== "file") throw new Error("expected tracked facts file")
    const receiptsBefore = (await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] !== undefined).length
    injectAfterNextWorktreeHash(() => writeFile(join(dir, path), "foreign existing deletion\n"))

    const removed = await repo.pathState.writeWorktreeIfIdentity(path, expected, { kind: "missing" })

    expect(removed).toBe(false)
    expect(await readFile(join(dir, path), "utf8")).toBe("foreign existing deletion\n")
    expect((await repo.pathState.capture(path)).index).toEqual(before.index)
    expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] !== undefined)).toHaveLength(receiptsBefore)
  })
})
