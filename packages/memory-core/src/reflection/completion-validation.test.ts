import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { validateDreamTokenBudget } from "./completion-validation"
import { createReflectionWorktree, finalizeReflectionWorktree } from "./worktree"

const roots: string[] = []

async function fixture(runId: string) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-validation-")))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init()
  const worktree = await createReflectionWorktree(repo, runId, join(root, "worktrees"))
  return { parentDir, worktree }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

describe("dream token budget completion validation", () => {
  it("#given a pressure dream whose merged system estimate remains at target #when validated #then budget_not_met is recorded", () => {
    expect(validateDreamTokenBudget({ origin: "pressure", totalTokens: 80, targetTokens: 80 })).toEqual({
      status: "budget_not_met",
      totalTokens: 80,
      targetTokens: 80,
      detail: "Committed system/ estimate is 80 tokens; pressure dream target is below 80 tokens",
    })
  })

  it("#given a pressure dream below target #when validated #then the estimate is clean", () => {
    expect(validateDreamTokenBudget({ origin: "pressure", totalTokens: 79, targetTokens: 80 })).toEqual({
      status: "valid",
      totalTokens: 79,
      targetTokens: 80,
    })
  })

  it("#given a non-pressure dream above target #when validated #then the estimate is reported without failing", () => {
    expect(validateDreamTokenBudget({ origin: "manual", totalTokens: 120, targetTokens: 80 })).toEqual({
      status: "valid",
      totalTokens: 120,
      targetTokens: 80,
    })
  })
})

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
