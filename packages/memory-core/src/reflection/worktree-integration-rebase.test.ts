import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createNodeGitExec, type GitExec } from "../git"
import { disableFixtureAutoMaintenance } from "../git/test-repo-config.test-support"
import { validateCompletion } from "./completion-validation"
import { integrateValidatedReflection, probeReflectionIntegration, type ValidatedReflectionTip } from "./worktree-integration"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

// #12075: facts extraction and memory saves commit to the parent while a reflection run works in its
// own worktree, so the finalize merge meets a real content conflict on the same note.
const roots: string[] = []
const exec = createNodeGitExec()
const FACTS = "notes/facts/2026-11.md"
const FACTS_BASE = "---\ndescription: November facts\n---\n- base fact\n"

setDefaultTimeout(process.platform === "win32" ? 30_000 : 10_000)
const unlocked = <T>(operation: () => Promise<T>) => operation()

async function fixture(runId: string) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-rebase-")))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init({
    seedFiles: [
      { relativePath: "memory.md", content: "base\n" },
      { relativePath: FACTS, content: FACTS_BASE },
    ],
  })
  disableFixtureAutoMaintenance(parentDir)
  const worktree = await createReflectionWorktree(repo, runId, join(root, "worktrees"))
  return { parentDir, repo, worktree }
}

async function commitIn(dir: string, path: string, content: string) {
  await writeFile(join(dir, path), content)
  const repo = new GitMemoryRepo({ dir, agentId: "agent-one" })
  return (await repo.commitWrite([path], "write", { agentId: "agent-one", authorName: "Writer" })).sha
}

async function git(cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}

async function validated(worktree: ReflectionWorktree): Promise<ValidatedReflectionTip> {
  const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
  if (validation.status !== "valid") throw new Error(`expected a valid reflection, got ${validation.status}`)
  return validation
}

async function expectParentClean(parentDir: string, head: string) {
  expect((await git(parentDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code).not.toBe(0)
  expect((await git(parentDir, ["status", "--porcelain"])).stdout).toBe("")
  expect((await git(parentDir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe("reflection integration after the parent moved (#12075)", () => {
  it("#given a facts append landed on the note the run also appended to #when integration runs #then the rebased tip merges with both appends", async () => {
    const { parentDir, worktree } = await fixture("append")
    await commitIn(worktree.dir, FACTS, `${FACTS_BASE}- run fact\n`)
    const tip = await validated(worktree)
    await commitIn(parentDir, FACTS, `${FACTS_BASE}- parent fact\n`)
    const rebasedTips: ValidatedReflectionTip[] = []

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "append",
      summary: "append",
      validated: tip,
      withWriterLock: unlocked,
      onRebased: async (rebased) => { rebasedTips.push(rebased) },
    })

    expect({ outcome: result.outcome, detail: result.detail }).toEqual({ outcome: "merged", detail: undefined })
    expect(await readFile(join(parentDir, FACTS), "utf8")).toBe(`${FACTS_BASE}- parent fact\n- run fact\n`)
    expect((await git(parentDir, ["status", "--porcelain"])).stdout).toBe("")
    expect(rebasedTips).toHaveLength(1)
    const mergedTip = rebasedTips[0]
    if (mergedTip === undefined) throw new Error("expected a rebased tip")
    expect(result.validated).toEqual(mergedTip)
    if (result.integrationSha === undefined) throw new Error("expected an integration sha")
    expect(mergedTip.changedPaths).toEqual([FACTS])
    expect((await git(parentDir, ["rev-parse", "HEAD^2"])).stdout.trim()).toBe(mergedTip.tipSha)
    await expect(probeReflectionIntegration(worktree, { mode: "auto", runId: "append", validatedTipSha: mergedTip.tipSha }))
      .resolves.toEqual({ status: "integrated", evidence: "receipt", integrationSha: result.integrationSha })
  })

  it("#given both sides rewrote the same line #when integration runs #then it stays merge_conflict naming the path and leaves both trees clean", async () => {
    const { parentDir, worktree } = await fixture("same-line")
    await commitIn(worktree.dir, "memory.md", "run\n")
    const tip = await validated(worktree)
    const parentHead = await commitIn(parentDir, "memory.md", "parent\n")

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto", runId: "same-line", summary: "same line", validated: tip, withWriterLock: unlocked,
    })

    expect(result.outcome).toBe("merge_conflict")
    expect(result.detail).toContain("memory.md")
    await expectParentClean(parentDir, parentHead)
    expect((await git(worktree.dir, ["status", "--porcelain"])).stdout).toBe("")
    expect((await git(worktree.dir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(tip.tipSha)
  })

  it("#given the merge abort leaves the parent mid-merge #when integration recovers #then it reports parent_dirty and never rebases", async () => {
    const { parentDir, worktree } = await fixture("abort-dirty")
    await commitIn(worktree.dir, "memory.md", "run\n")
    const tip = await validated(worktree)
    await commitIn(parentDir, "memory.md", "parent\n")
    const seen: string[][] = []
    const swallowAbort: GitExec = {
      run: async (argv, options) => {
        seen.push([...argv])
        if (argv.includes("--abort") && options.cwd === parentDir) return { code: 0, stdout: "", stderr: "" }
        return exec.run(argv, options)
      },
    }

    const result = await integrateValidatedReflection({ ...worktree, exec: swallowAbort }, {
      mode: "auto", runId: "abort-dirty", summary: "abort dirty", validated: tip, withWriterLock: unlocked,
    })

    expect(result.outcome).toBe("parent_dirty")
    expect(result.detail).toContain("memory.md")
    expect(seen.some((argv) => argv.includes("rebase"))).toBe(false)
  })

  it("#given the rebased tip fails completion validation #when integration recovers #then nothing merges and the outcome says why", async () => {
    const { parentDir, worktree } = await fixture("revalidate")
    await commitIn(worktree.dir, FACTS, `${FACTS_BASE}- run fact\n`)
    const tip = await validated(worktree)
    const parentHead = await commitIn(parentDir, FACTS, `${FACTS_BASE}- parent fact\n`)
    // The run's completion gate refuses a branch whose git administration files changed under it.
    expect((await git(parentDir, ["config", "--local", "omo.probe", "changed"])).code).toBe(0)
    const rebasedTips: ValidatedReflectionTip[] = []

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "revalidate",
      summary: "revalidate",
      validated: tip,
      withWriterLock: unlocked,
      onRebased: async (rebased) => { rebasedTips.push(rebased) },
    })

    expect(result.outcome).toBe("failed")
    expect(result.detail).toContain("Git administration files were modified")
    expect(rebasedTips).toEqual([])
    await expectParentClean(parentDir, parentHead)
  })
})
