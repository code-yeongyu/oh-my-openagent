import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { createNodeGitExec, reflectionSchedulerLockPath } from "@oh-my-opencode/memory-core"

import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"
import {
  cleanupReconciliationFixtures,
  contendedReservation,
  reconciliationFixture as fixture,
  withinPhase,
} from "./run-reconciliation.test-support"

const exec = createNodeGitExec()
const HOUR_MS = 60 * 60_000

afterEach(cleanupReconciliationFixtures)

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  const result = await exec.run(["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repoDir, timeoutMs: 30_000 })
  return result.code === 0
}

/** A worktree left by a run whose directory is long gone: registered, aged, owned by nobody. */
async function addOrphanWorktree(item: Awaited<ReturnType<typeof fixture>>, epoch: number) {
  const head = await item.repo.head()
  if (head === null) throw new Error("expected a seeded head")
  const suffix = `${epoch}-run-gone`
  const dir = join(item.identity.paths.worktrees, suffix)
  const branch = `memory/reflection-${suffix}`
  await item.repo.worktreeAdd(dir, branch, head)
  return { dir, branch }
}

/** Keeps the fixture run alive for the whole pass so only the sweep can touch its worktree. */
async function keepRunAlive(item: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
    ...item.ledger,
    pid: 4242,
    processStart: "supervisor-start",
  })
}

describe("reflection reconciliation orphan sweep", () => {
  test("#given an aged orphan worktree beside a live run #when reconciliation finishes #then only the orphan is discarded", async () => {
    // given
    const item = await fixture()
    await keepRunAlive(item)
    const orphan = await addOrphanWorktree(item, Date.now() - HOUR_MS)
    const warnings: { readonly message: string; readonly details?: Record<string, unknown> }[] = []

    // when
    const results = await withinPhase("sweep-reconcile", () => reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      now: () => Date.now() + HOUR_MS,
      getPidLiveness: () => "alive",
      getProcessStartIdentity: async () => "supervisor-start",
      waitForOutcome: async () => "timeout",
      logger: { warn: (message, details) => { warnings.push({ message, ...(details === undefined ? {} : { details }) }) } },
    }))

    // then
    expect(results).toEqual([])
    expect(existsSync(orphan.dir)).toBe(false)
    expect(await branchExists(item.identity.paths.repo, orphan.branch)).toBe(false)
    expect(existsSync(item.worktree.dir)).toBe(true)
    expect(await branchExists(item.identity.paths.repo, item.worktree.branch)).toBe(true)
    expect(existsSync(join(item.runDir, "final.json"))).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.details).toMatchObject({ kind: "worktree", target: orphan.dir })
  }, 30_000)

  test("#given scheduler contention #when the pass defers #then no leftover is swept", async () => {
    // given
    const item = await fixture()
    const orphan = await addOrphanWorktree(item, Date.now() - HOUR_MS)

    // when
    const results = await withinPhase("deferred-sweep", () => reconcileReflectionRuns({
      identity: item.identity,
      reservation: contendedReservation(reflectionSchedulerLockPath(item.identity.paths.locks), null),
      now: () => Date.now() + HOUR_MS,
      deferOnSchedulerContention: true,
    }))

    // then
    expect(results).toEqual([])
    expect(existsSync(orphan.dir)).toBe(true)
    expect(await branchExists(item.identity.paths.repo, orphan.branch)).toBe(true)
  }, 30_000)
})
