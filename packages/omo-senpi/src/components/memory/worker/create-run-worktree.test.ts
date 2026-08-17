import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { createRunWorktree } from "./create-run-worktree"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-run-worktree-")))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: [{ relativePath: "system/base.md", content: "---\ndescription: Base\n---\nbase\n" }] })
  return { identity, repo }
}

describe("reflection run worktree creation", () => {
  test("#given a run directory left by an earlier run with the same id #when a new run starts #then it refuses to reuse the directory and preserves its artifacts", async () => {
    // given
    const { identity, repo } = await fixture()
    const runDir = join(identity.paths.reflection, "runs", "reflection-run-4")
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    const stale = JSON.stringify({ version: 1, runId: "reflection-run-4", outcome: "merged" })
    await writeFile(join(runDir, "final.json"), stale, "utf8")

    // when
    const creation = createRunWorktree(repo, "reflection-run-4", identity.paths)

    // then
    await expect(creation).rejects.toThrow(/already exists/)
    expect(await readFile(join(runDir, "final.json"), "utf8")).toBe(stale)
  }, 30_000)

  test("#given a fresh run id #when a run starts #then the run directory and its prelaunch record are created", async () => {
    // given
    const { identity, repo } = await fixture()

    // when
    const worktree = await createRunWorktree(repo, "reflection-run-1786965155436-a1b2c3d4", identity.paths)

    // then
    const runDir = join(identity.paths.reflection, "runs", "reflection-run-1786965155436-a1b2c3d4")
    expect(existsSync(worktree.dir)).toBe(true)
    expect(JSON.parse(await readFile(join(runDir, "prelaunch.json"), "utf8"))).toMatchObject({
      runId: "reflection-run-1786965155436-a1b2c3d4",
      worktreeDir: worktree.dir,
      worktreeBranch: worktree.branch,
    })
  }, 30_000)
})
