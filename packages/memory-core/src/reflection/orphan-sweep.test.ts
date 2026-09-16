import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import {
  listReflectionLeftovers,
  selectReflectionOrphans,
  sweepReflectionOrphans,
} from "./orphan-sweep"

const roots: string[] = []
const INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 30_000 : 10_000
const HOUR_MS = 60 * 60_000
const exec = createNodeGitExec()

setDefaultTimeout(INTEGRATION_TEST_TIMEOUT)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  ))
})

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  const result = await exec.run(["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repoDir, timeoutMs: 30_000 })
  return result.code === 0
}

async function fixture(now: number) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-orphan-sweep-")))
  roots.push(root)
  const repoDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: repoDir, agentId: "agent-one" })
  await repo.init({ seedFiles: [{ relativePath: "memory.md", content: "base\n" }] })
  const head = await repo.head()
  if (head === null) throw new Error("expected a seeded head")
  const worktreesDir = join(root, "worktrees")
  await mkdir(worktreesDir, { recursive: true })

  const register = async (suffix: string) => {
    const dir = join(worktreesDir, suffix)
    const branch = `memory/reflection-${suffix}`
    await repo.worktreeAdd(dir, branch, head)
    return { dir, branch }
  }
  const stale = await register(`${now - HOUR_MS}-run-stale`)
  const live = await register(`${now - HOUR_MS}-run-live`)
  const fresh = await register(`${now - 60_000}-run-fresh`)
  const strayDir = join(worktreesDir, `${now - HOUR_MS}-run-stray`)
  await mkdir(strayDir, { recursive: true })
  await writeFile(join(strayDir, "leftover.md"), "leftover\n")
  await exec.run(["branch", "reflection/run-3", head], { cwd: repoDir, timeoutMs: 30_000 })

  return { root, repoDir, repo, worktreesDir, stale, live, fresh, strayDir }
}

describe("reflection orphan sweep", () => {
  it("#given leftovers under the worktrees dir #when they are listed #then registered worktrees strays and reflection branches are reported", async () => {
    // #given
    const now = Date.now()
    const item = await fixture(now)

    // #when
    const leftovers = await listReflectionLeftovers(item.repo, item.worktreesDir, exec)

    // #then
    expect([...leftovers.registeredWorktrees].sort((a, b) => a.dir.localeCompare(b.dir))).toEqual([
      { dir: item.live.dir, branch: item.live.branch, present: true },
      { dir: item.stale.dir, branch: item.stale.branch, present: true },
      { dir: item.fresh.dir, branch: item.fresh.branch, present: true },
    ].sort((a, b) => a.dir.localeCompare(b.dir)))
    expect(leftovers.strayDirs).toEqual([item.strayDir])
    expect([...leftovers.branches].sort()).toEqual([
      item.fresh.branch,
      item.live.branch,
      item.stale.branch,
      "reflection/run-3",
    ].sort())
  })

  it("#given live and fresh leftovers #when orphans are selected #then only unowned aged items and legacy branches are chosen", () => {
    // #given
    const now = 1_800_000_000_000
    const leftovers = {
      registeredWorktrees: [
        { dir: `/w/${now - HOUR_MS}-run-stale`, branch: `memory/reflection-${now - HOUR_MS}-run-stale`, present: true },
        { dir: `/w/${now - HOUR_MS}-run-live`, branch: `memory/reflection-${now - HOUR_MS}-run-live`, present: true },
        { dir: `/w/${now - 60_000}-run-fresh`, branch: `memory/reflection-${now - 60_000}-run-fresh`, present: true },
        { dir: `/w/${now - 60_000}-run-pruned`, branch: `memory/reflection-${now - 60_000}-run-pruned`, present: false },
      ],
      strayDirs: [`/w/${now - HOUR_MS}-run-stray`, `/w/unrelated`],
      branches: ["reflection/run-3", "reflection/run-9", `memory/reflection-${now - 60_000}-run-fresh`],
    }

    // #when
    const orphans = selectReflectionOrphans(leftovers, {
      liveRunIds: new Set(["run-live", "reflection-run-9"]),
      now,
      graceMs: 15 * 60_000,
    })

    // #then
    expect(orphans.registeredWorktrees.map((worktree) => worktree.dir)).toEqual([
      `/w/${now - HOUR_MS}-run-stale`,
      `/w/${now - 60_000}-run-pruned`,
    ])
    expect(orphans.strayDirs).toEqual([`/w/${now - HOUR_MS}-run-stray`])
    expect(orphans.branches).toEqual(["reflection/run-3"])
  })

  it("#given stale registered stray and legacy leftovers #when the sweep runs #then they are removed and live or fresh ones survive", async () => {
    // #given
    const now = Date.now()
    const item = await fixture(now)

    // #when
    const receipts = await sweepReflectionOrphans(item.repo, item.worktreesDir, {
      liveRunIds: new Set(["run-live"]),
      now,
      graceMs: 15 * 60_000,
      exec,
    })

    // #then
    expect(receipts.every((receipt) => receipt.removed)).toBe(true)
    expect(receipts.map((receipt) => `${receipt.kind}:${receipt.target}`).sort()).toEqual([
      `branch:reflection/run-3`,
      `directory:${item.strayDir}`,
      `worktree:${item.stale.dir}`,
    ].sort())
    expect(existsSync(item.stale.dir)).toBe(false)
    expect(await branchExists(item.repoDir, item.stale.branch)).toBe(false)
    expect(existsSync(item.strayDir)).toBe(false)
    expect(await branchExists(item.repoDir, "reflection/run-3")).toBe(false)
    expect(existsSync(item.live.dir)).toBe(true)
    expect(await branchExists(item.repoDir, item.live.branch)).toBe(true)
    expect(existsSync(item.fresh.dir)).toBe(true)
    expect(await branchExists(item.repoDir, item.fresh.branch)).toBe(true)
  })

  it("#given an aged directory beside the worktrees dir #when the sweep runs #then only entries inside the worktrees dir are removed", async () => {
    // #given
    const now = Date.now()
    const item = await fixture(now)
    const outside = join(item.root, `${now - HOUR_MS}-run-escape`)
    await mkdir(outside, { recursive: true })

    // #when
    const receipts = await sweepReflectionOrphans(item.repo, item.worktreesDir, {
      liveRunIds: new Set<string>(),
      now,
      exec,
    })

    // #then
    expect(receipts.some((receipt) => receipt.target === outside)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })
})
