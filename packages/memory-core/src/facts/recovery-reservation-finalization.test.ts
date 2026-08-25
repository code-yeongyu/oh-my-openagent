import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, createNodeGitExec } from "../git"
import { buildDefaultSeedFiles } from "../seeds"
import { applyFactsBatch } from "./extraction"
import { planFactsMutation, type FactsApplyRecovery } from "./mutation-plan"
import { applyFactsRecovery } from "./recovery"

const AUTHOR = { agentId: "facts-reservation-race", authorName: "Facts Reservation Race" }
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const tempDirs: string[] = []

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "facts-reservation-race-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  await applyFactsBatch(repo, {
    batchId: "11111111-1111-4111-8111-111111111111",
    records: [{ scope: "project", text: "Initial August.", date: "2026-08-01" }],
  }, AUTHOR)
  return { dir, repo }
}

async function deletionRecovery(repo: GitMemoryRepo): Promise<FactsApplyRecovery> {
  const planned = await planFactsMutation(repo, {
    batchId: "22222222-2222-4222-8222-222222222222",
    records: [
      { scope: "project", text: "August update.", date: "2026-08-10" },
      { scope: "project", text: "September.", date: "2026-09-01" },
    ],
  }, undefined)
  const august = "notes/facts/2026-08.md"
  const current = await repo.pathState.capture(august)
  if (current.index === null || current.worktree.kind !== "file") throw new Error("expected August")
  return {
    ...planned,
    paths: planned.paths.map((entry) => entry.path === august ? {
      path: august,
      pre: { index: null, worktree: { kind: "missing" as const } },
      post: { index: current.index!, worktree: current.worktree as Extract<typeof current.worktree, { kind: "file" }> },
    } : entry),
  }
}

async function indexIdentity(repo: GitMemoryRepo, path: string): Promise<string> {
  const result = await createNodeGitExec().run(["ls-files", "--stage", "--", path], { cwd: repo.dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout
}

function expectNoReceipt(repo: GitMemoryRepo, batchId: string): Promise<void> {
  return repo.log().then((commits) => {
    expect(commits.some((commit) => commit.trailers["Omo-Facts-Batch"] === batchId)).toBe(false)
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })))
})

describe("facts deletion reservation finalization", () => {
  test("preserves a foreign directory replacing the verified reservation", async () => {
    const { dir, repo } = await fixture()
    const recovery = await deletionRecovery(repo)
    const target = join(dir, "notes/facts/2026-08.md")
    let conditionalDeletion: boolean | undefined
    const originalWrite = repo.pathState.writeWorktreeIfIdentity.bind(repo.pathState)
    repo.pathState.writeWorktreeIfIdentity = async (path, expected, next) => {
      repo.pathState.writeWorktreeIfIdentity = originalWrite
      conditionalDeletion = await originalWrite(path, expected, next)
      return conditionalDeletion
    }
    const originalReserve = repo.pathState.reserveWorktreeDeletion.bind(repo.pathState)
    let foreignIdentity: { dev: number; ino: number } | undefined
    repo.pathState.reserveWorktreeDeletion = async (path, moved) => {
      repo.pathState.reserveWorktreeDeletion = originalReserve
      const reservation = await originalReserve(path, moved)
      if (reservation === undefined) return undefined
      return {
        verify: async () => {
          const finalizer = await reservation.verify()
          if (finalizer === undefined) return undefined
          await rm(target, { recursive: true })
          await mkdir(target)
          const foreign = await lstat(target)
          foreignIdentity = { dev: foreign.dev, ino: foreign.ino }
          return finalizer
        },
      }
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    expect(conditionalDeletion).toBe(false)
    if (result.outcome !== "parent_dirty" || result.detail === undefined) throw new Error("missing recovery detail")
    const retained = await lstat(result.detail.replace("Foreign entry retained at ", ""))
    expect(retained.isDirectory()).toBe(true)
    if (foreignIdentity === undefined) throw new Error("foreign directory was not installed")
    expect({ dev: retained.dev, ino: retained.ino }).toEqual(foreignIdentity)
    await expectNoReceipt(repo, recovery.batchId)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  test("does not overwrite a newer foreign file while restoring a mismatched claim", async () => {
    const { dir, repo } = await fixture()
    const recovery = await deletionRecovery(repo)
    const august = "notes/facts/2026-08.md"
    const september = "notes/facts/2026-09.md"
    const target = join(dir, august)
    const indexBefore = await repo.pathState.captureAll([august, september])
    let conditionalDeletion: boolean | undefined
    const originalWrite = repo.pathState.writeWorktreeIfIdentity.bind(repo.pathState)
    repo.pathState.writeWorktreeIfIdentity = async (path, expected, next) => {
      repo.pathState.writeWorktreeIfIdentity = originalWrite
      conditionalDeletion = await originalWrite(path, expected, next)
      return conditionalDeletion
    }
    const originalReserve = repo.pathState.reserveWorktreeDeletion.bind(repo.pathState)
    repo.pathState.reserveWorktreeDeletion = async (path, moved) => {
      repo.pathState.reserveWorktreeDeletion = originalReserve
      const reservation = await originalReserve(path, moved)
      if (reservation === undefined) return undefined
      return { verify: async () => {
        const finalizer = await reservation.verify()
        if (finalizer === undefined) return undefined
        await rm(target, { recursive: true })
        await writeFile(target, "foreign A\n")
        return finalizer
      } }
    }
    const originalRestore = repo.pathState.restoreWorktreeClaim.bind(repo.pathState)
    repo.pathState.restoreWorktreeClaim = async (path, claimed) => {
      repo.pathState.restoreWorktreeClaim = originalRestore
      await writeFile(target, "foreign B sentinel\n")
      return originalRestore(path, claimed)
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)

    expect(result.outcome).toBe("parent_dirty")
    expect(conditionalDeletion).toBe(false)
    expect(await readFile(target, "utf8")).toBe("foreign B sentinel\n")
    if (result.outcome !== "parent_dirty" || result.detail === undefined) throw new Error("missing recovery detail")
    const retained = result.detail.replace("Foreign entry retained at ", "")
    expect(await readFile(retained, "utf8")).toBe("foreign A\n")
    expect((await repo.pathState.capture(august)).index).toEqual(indexBefore.get(august)?.index ?? null)
    expect((await repo.pathState.capture(september)).index).toEqual(indexBefore.get(september)?.index ?? null)
    expect(await repo.pathState.capture(september)).toEqual(recovery.paths.find((entry) => entry.path === september)!.pre)
    await expectNoReceipt(repo, recovery.batchId)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  test("does not overwrite a newer foreign directory while restoring a mismatched claim", async () => {
    const { dir, repo } = await fixture()
    const recovery = await deletionRecovery(repo)
    const august = "notes/facts/2026-08.md"
    const september = "notes/facts/2026-09.md"
    const target = join(dir, august)
    const augustIndexBefore = await indexIdentity(repo, august)
    const septemberIndexBefore = await indexIdentity(repo, september)
    let conditionalDeletion: boolean | undefined
    let foreignB: { dev: number; ino: number } | undefined
    const originalWrite = repo.pathState.writeWorktreeIfIdentity.bind(repo.pathState)
    repo.pathState.writeWorktreeIfIdentity = async (path, expected, next) => {
      repo.pathState.writeWorktreeIfIdentity = originalWrite
      conditionalDeletion = await originalWrite(path, expected, next)
      return conditionalDeletion
    }
    const originalReserve = repo.pathState.reserveWorktreeDeletion.bind(repo.pathState)
    repo.pathState.reserveWorktreeDeletion = async (path, moved) => {
      repo.pathState.reserveWorktreeDeletion = originalReserve
      const reservation = await originalReserve(path, moved)
      if (reservation === undefined) return undefined
      return { verify: async () => {
        const finalizer = await reservation.verify()
        if (finalizer === undefined) return undefined
        await rm(target, { recursive: true })
        await mkdir(target)
        return finalizer
      } }
    }
    const originalRestore = repo.pathState.restoreWorktreeClaim.bind(repo.pathState)
    repo.pathState.restoreWorktreeClaim = async (path, claimed) => {
      repo.pathState.restoreWorktreeClaim = originalRestore
      await mkdir(target)
      const identity = await lstat(target)
      foreignB = { dev: identity.dev, ino: identity.ino }
      return originalRestore(path, claimed)
    }

    const result = await applyFactsRecovery(repo, recovery, 2, AUTHOR)
    const remaining = await lstat(target)

    expect(result.outcome).toBe("parent_dirty")
    expect(conditionalDeletion).toBe(false)
    if (result.outcome !== "parent_dirty" || result.detail === undefined) throw new Error("missing recovery detail")
    const retained = result.detail.replace("Foreign entry retained at ", "")
    expect((await lstat(retained)).isDirectory()).toBe(true)
    if (foreignB === undefined) throw new Error("foreign directory B was not installed")
    expect({ dev: remaining.dev, ino: remaining.ino }).toEqual(foreignB)
    expect(await indexIdentity(repo, august)).toBe(augustIndexBefore)
    expect(await indexIdentity(repo, september)).toBe(septemberIndexBefore)
    expect(await repo.pathState.capture(september)).toEqual(recovery.paths.find((entry) => entry.path === september)!.pre)
    await expectNoReceipt(repo, recovery.batchId)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  test("preserves a foreign file replacing the verified reservation and returns parent_dirty", async () => {
    const { dir, repo } = await fixture()
    const recovery = await deletionRecovery(repo)
    const august = "notes/facts/2026-08.md"
    const september = "notes/facts/2026-09.md"
    const target = join(dir, august)
    const indexBefore = await repo.pathState.captureAll([august, september])
    const originalReserve = repo.pathState.reserveWorktreeDeletion.bind(repo.pathState)
    repo.pathState.reserveWorktreeDeletion = async (path, moved) => {
      repo.pathState.reserveWorktreeDeletion = originalReserve
      const reservation = await originalReserve(path, moved)
      if (reservation === undefined) return undefined
      return {
        verify: async () => {
          const finalizer = await reservation.verify()
          if (finalizer === undefined) return undefined
          await rm(target, { recursive: true })
          await writeFile(target, "foreign finalization sentinel\n")
          return finalizer
        },
      }
    }

    const outcome = await applyFactsRecovery(repo, recovery, 2, AUTHOR)
      .then((result) => result.outcome, () => "failed" as const)

    expect(outcome).toBe("parent_dirty")
    expect(await readFile(target, "utf8")).toBe("foreign finalization sentinel\n")
    expect((await repo.pathState.capture(august)).index).toEqual(indexBefore.get(august)?.index ?? null)
    expect((await repo.pathState.capture(september)).index).toEqual(indexBefore.get(september)?.index ?? null)
    expect(await repo.pathState.capture(september)).toEqual(recovery.paths.find((entry) => entry.path === september)!.pre)
    await expectNoReceipt(repo, recovery.batchId)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)
})
