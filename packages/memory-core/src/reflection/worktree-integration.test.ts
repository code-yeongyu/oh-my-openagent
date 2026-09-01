import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { validateCompletion } from "./completion-validation"
import {
  cleanupReflectionWorktree,
  integrateValidatedReflection,
  probeLegacyAutoRunReceipt,
  probeReflectionIntegration,
} from "./worktree-integration"
import { createReflectionWorktree, type ReflectionWorktree } from "./worktree"

const roots: string[] = []
const WINDOWS_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000
const exec = createNodeGitExec()

setDefaultTimeout(WINDOWS_INTEGRATION_TEST_TIMEOUT)
const unlocked = <T>(operation: () => Promise<T>) => operation()

async function fixture(runId = "run-123") {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-integration-")))
  roots.push(root)
  const parentDir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir: parentDir, agentId: "agent-one" })
  await repo.init({ seedFiles: [{ relativePath: "memory.md", content: "base\n" }] })
  const worktree = await createReflectionWorktree(repo, runId, join(root, "worktrees"))
  return { root, parentDir, repo, worktree }
}

async function commit(worktree: ReflectionWorktree, path: string, content: string) {
  await writeFile(join(worktree.dir, path), content)
  const child = new GitMemoryRepo({ dir: worktree.dir, agentId: "agent-one" })
  return child.commitWrite([path], "reflect", { agentId: "agent-one", authorName: "Reflection Agent" })
}

async function git(cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("reflection worktree integration", () => {
  it("#given a validated tip #when auto integration lands #then it creates a no-ff receipt without cleaning resources", async () => {
    const { parentDir, worktree } = await fixture()
    await commit(worktree, "learned.md", "learned\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    expect(validation.status).toBe("valid")
    if (validation.status !== "valid") throw new Error("expected valid reflection")

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "run-123",
      summary: "learned facts",
      validated: validation,
      withWriterLock: unlocked,
    })

    expect(result.outcome).toBe("merged")
    expect(result.integrationSha).toBe((await git(parentDir, ["rev-parse", "HEAD"])).stdout.trim())
    expect((await git(parentDir, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(" ")).toHaveLength(3)
    expect((await git(parentDir, ["show", "-s", "--format=%B", "HEAD"])).stdout).toContain("Omo-Run: run-123")
    expect(existsSync(worktree.dir)).toBe(true)
    expect((await git(parentDir, ["show-ref", "--verify", `refs/heads/${worktree.branch}`])).code).toBe(0)
  })

  it("#given legacy auto receipts #when probed without a validated tip #then only the exact trailer is accepted", async () => {
    const { parentDir, worktree } = await fixture("legacy")
    expect((await git(parentDir, [
      "commit", "--allow-empty", "-m", "non-exact", "-m", "Omo-Run: legacy-extra",
    ])).code).toBe(0)
    await expect(probeLegacyAutoRunReceipt(worktree, "legacy")).resolves.toEqual({ status: "not_integrated" })

    expect((await git(parentDir, [
      "commit", "--allow-empty", "-m", "exact", "-m", "Omo-Run: legacy",
    ])).code).toBe(0)
    const integrationSha = (await git(parentDir, ["rev-parse", "HEAD"])).stdout.trim()
    await expect(probeLegacyAutoRunReceipt(worktree, "legacy")).resolves.toEqual({
      status: "integrated",
      evidence: "receipt",
      integrationSha,
    })
  })

  it("#given a landed auto merge #when probed #then exact receipt and validated-tip ancestry prove integration", async () => {
    const { worktree } = await fixture("receipt")
    await commit(worktree, "receipt.md", "receipt\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    const merged = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "receipt",
      summary: "receipt proof",
      validated: validation,
      withWriterLock: unlocked,
    })

    expect(merged.outcome).toBe("merged")
    if (merged.outcome !== "merged" || merged.integrationSha === undefined) throw new Error("expected merge receipt")
    await expect(probeReflectionIntegration(worktree, {
      mode: "auto",
      runId: "receipt",
      validatedTipSha: validation.tipSha,
    })).resolves.toEqual({ status: "integrated", evidence: "receipt", integrationSha: merged.integrationSha })
  })

  it("#given a matching receipt that excludes the validated tip #when probed #then it is rejected", async () => {
    const { parentDir, worktree } = await fixture("false-receipt")
    await commit(worktree, "unmerged.md", "unmerged\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    expect((await git(parentDir, ["commit", "--allow-empty", "-m", "unrelated", "-m", "Omo-Run: false-receipt"])).code).toBe(0)

    await expect(probeReflectionIntegration(worktree, {
      mode: "auto",
      runId: "false-receipt",
      validatedTipSha: validation.tipSha,
    })).resolves.toEqual({ status: "not_integrated" })
  })

  it("#given a non-exact receipt on an integrated tip #when auto mode probes #then only ancestry is accepted", async () => {
    const { parentDir, worktree } = await fixture("exact")
    await commit(worktree, "exact.md", "exact\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    expect((await git(parentDir, [
      "merge", "--no-ff", validation.tipSha, "-m", "manual integration", "-m", "Omo-Run: exact-extra",
    ])).code).toBe(0)
    const integrationSha = (await git(parentDir, ["rev-parse", "HEAD"])).stdout.trim()

    await expect(probeReflectionIntegration(worktree, {
      mode: "auto",
      runId: "exact",
      validatedTipSha: validation.tipSha,
    })).resolves.toEqual({ status: "integrated", evidence: "ancestry", integrationSha })
  })

  it("#given external integration without a receipt #when either mode probes #then ancestry proves integration", async () => {
    const { repo, worktree } = await fixture("external")
    await commit(worktree, "external.md", "external\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    const integrationSha = await repo.merge(validation.tipSha, { noFF: true, message: "manual integration" })

    await expect(probeReflectionIntegration(worktree, {
      mode: "auto",
      runId: "external",
      validatedTipSha: validation.tipSha,
    })).resolves.toEqual({ status: "integrated", evidence: "ancestry", integrationSha })
    await expect(probeReflectionIntegration(worktree, {
      mode: "integration",
      runId: "external",
      validatedTipSha: validation.tipSha,
    })).resolves.toEqual({ status: "integrated", evidence: "ancestry", integrationSha })
  })

  it("#given an owned interrupted merge #when auto integration retries #then it aborts that merge and lands one clean merge", async () => {
    const { parentDir, worktree } = await fixture("owned")
    await commit(worktree, "owned.md", "owned\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    expect((await git(parentDir, ["merge", "--no-ff", "--no-commit", validation.tipSha])).code).toBe(0)
    expect((await git(parentDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).stdout.trim()).toBe(validation.tipSha)

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "owned",
      summary: "owned residue",
      validated: validation,
      withWriterLock: unlocked,
    })

    expect(result.outcome).toBe("merged")
    expect((await git(parentDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).code).not.toBe(0)
    expect((await git(parentDir, ["status", "--porcelain"])).stdout).toBe("")
  })

  it("#given foreign merge residue #when auto integration runs #then parent index and merge state remain untouched", async () => {
    const { root, parentDir, repo, worktree } = await fixture("target")
    await commit(worktree, "target.md", "target\n")
    const validation = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    if (validation.status !== "valid") throw new Error("expected valid reflection")
    const foreign = await createReflectionWorktree(repo, "foreign", join(root, "worktrees"))
    await commit(foreign, "foreign.md", "foreign\n")
    const foreignTip = (await git(foreign.dir, ["rev-parse", "HEAD"])).stdout.trim()
    expect((await git(parentDir, ["merge", "--no-ff", "--no-commit", foreignTip])).code).toBe(0)
    const beforeStatus = (await git(parentDir, ["status", "--porcelain=v2"])).stdout
    const beforeTree = (await git(parentDir, ["write-tree"])).stdout.trim()

    const result = await integrateValidatedReflection(worktree, {
      mode: "auto",
      runId: "target",
      summary: "must not interfere",
      validated: validation,
      withWriterLock: unlocked,
    })

    expect(result.outcome).toBe("parent_dirty")
    expect((await git(parentDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])).stdout.trim()).toBe(foreignTip)
    expect((await git(parentDir, ["status", "--porcelain=v2"])).stdout).toBe(beforeStatus)
    expect((await git(parentDir, ["write-tree"])).stdout.trim()).toBe(beforeTree)
  }, WINDOWS_INTEGRATION_TEST_TIMEOUT)

  it("#given present then absent resources #when cleanup repeats #then both receipts confirm absence", async () => {
    const { parentDir, worktree } = await fixture("cleanup")

    expect(await cleanupReflectionWorktree(worktree)).toEqual({ worktreeRemoved: true, branchRemoved: true })
    expect(await cleanupReflectionWorktree(worktree)).toEqual({ worktreeRemoved: true, branchRemoved: true })
    expect(existsSync(worktree.dir)).toBe(false)
    expect((await git(parentDir, ["show-ref", "--verify", `refs/heads/${worktree.branch}`])).code).not.toBe(0)
  })
})
