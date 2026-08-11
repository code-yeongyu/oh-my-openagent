import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { createReflectionWorktree, finalizeReflectionWorktree } from "./worktree"

const roots: string[] = []

async function fixture(runId: string) {
  const root = await mkdtemp(join(tmpdir(), "reflection-validation-"))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init()
  const worktree = await createReflectionWorktree(repo, runId, join(root, "worktrees"))
  return { parentDir, worktree }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

describe("reflection completion validation", () => {
  it("#given an uncommitted worktree edit #when finalized #then it reports dirty_uncommitted and cleans up", async () => {
    // #given
    const { parentDir, worktree } = await fixture("dirty")
    await writeFile(join(worktree.dir, "dirty.md"), "dirty\n")

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "dirty",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("dirty_uncommitted")
    expect(result.cleanup).toEqual({ worktreeRemoved: true, branchRemoved: true })
    expect(existsSync(worktree.dir)).toBe(false)
    expect(await branchExists(parentDir, worktree.branch)).toBe(false)
  })

  it("#given the linked-worktree .git administration file is altered #when finalized #then validation fails and cleans up", async () => {
    // #given
    const { parentDir, worktree } = await fixture("admin")
    const gitFile = join(worktree.dir, ".git")
    await writeFile(gitFile, `${await readFile(gitFile, "utf8")}# tampered\n`)

    // #when
    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "tampered",
      withWriterLock: async (operation) => operation(),
    })

    // #then
    expect(result.status).toBe("failed")
    expect(result.detail).toContain("administration")
    expect(result.cleanup).toEqual({ worktreeRemoved: true, branchRemoved: true })
    expect(existsSync(worktree.dir)).toBe(false)
    expect(await branchExists(parentDir, worktree.branch)).toBe(false)
  })
})

async function branchExists(parentDir: string, branch: string): Promise<boolean> {
  const { createNodeGitExec } = await import("../git")
  const result = await createNodeGitExec().run(["show-ref", "--verify", `refs/heads/${branch}`], {
    cwd: parentDir,
    timeoutMs: 30_000,
  })
  return result.code === 0
}
