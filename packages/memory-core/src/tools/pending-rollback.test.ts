import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, inspectStrandedGitLock, unlockStrandedGitLock, type GitCommitAuthor, type UnlockScans } from "../git"
import { PendingRollbackEditsKeptError } from "../git/pending-rollback"
import { renderMemoryFile } from "../memfs/frontmatter"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { removeTree } from "../../../../test-support/remove-tree"

// omo #10199: a write that failed with its change staged behind a locked index leaves a pending
// rollback. Every write entry point must settle it first, and settling must only undo the index:
// a file edited after the failure keeps its contents and is reported.

setDefaultTimeout(90_000)

const AUTHOR: GitCommitAuthor = { agentId: "agent-pending-rollback", authorName: "Pending Rollback" }
const NOBODY: UnlockScans = { findHolders: async () => [], findRepoUsers: async () => [] }

class IndexLockAtCommitRepo extends GitMemoryRepo {
  override async commitPrepared(...args: Parameters<GitMemoryRepo["commitPrepared"]>): ReturnType<GitMemoryRepo["commitPrepared"]> {
    await writeFile(join(this.dir, ".git", "index.lock"), "", "utf8")
    return super.commitPrepared(...args)
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

const lock: MemoryToolLock = async (_domain, operation) => operation()

async function git(dir: string, argv: readonly string[]): Promise<void> {
  const child = spawn("git", [...argv], { cwd: dir, stdio: "ignore" })
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve))
  if (code !== 0) throw new Error(`git ${argv.join(" ")} exited ${code}`)
}

// A repository whose last memory write (the given command) failed with its change staged while
// index.lock was held, and whose lock the user then removed with /memory unlock.
async function afterStagedFailure(params: Parameters<typeof runMemoryTool>[0]["params"], seeded?: string) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-pending-rollback-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  if (seeded !== undefined) {
    await mkdir(join(repo.dir, "system"), { recursive: true })
    await writeFile(join(repo.dir, seeded), renderMemoryFile({ description: "Seed" }, "old fact\n"), "utf8")
    await repo.commitWrite([seeded], "seed", AUTHOR)
  }
  const failing = new IndexLockAtCommitRepo({ dir: repo.dir, agentId: AUTHOR.agentId })
  const failure = await runMemoryTool({ repo: failing, lock, params }).catch((error: unknown) => error)
  expect(String(failure)).toContain("still staged")
  const lockPath = join(repo.dir, ".git", "index.lock")
  const inspection = await inspectStrandedGitLock(repo.dir, lockPath, NOBODY)
  if (inspection.kind !== "found") throw new Error(`unexpected ${inspection.kind}`)
  expect((await unlockStrandedGitLock(repo.dir, inspection, NOBODY)).kind).toBe("removed")
  return repo
}

function keptPaths(failure: unknown): readonly string[] | undefined {
  if (!(failure instanceof Error) || !(failure.cause instanceof PendingRollbackEditsKeptError)) return undefined
  return failure.cause.paths
}

const CREATE_NEW = { command: "create", reason: "write behind a commit-time lock", file_path: "system/new.md", description: "Fact", file_text: "new fact", author: AUTHOR } as const

async function writeOther(repo: GitMemoryRepo): Promise<void> {
  await mkdir(dirname(join(repo.dir, "system/other.md")), { recursive: true })
  await writeFile(join(repo.dir, "system/other.md"), renderMemoryFile({ description: "Other" }, "other fact\n"), "utf8")
}

describe("a pending rollback after a staged failure (omo #10199)", () => {
  it("#given a pending rollback #when the next write is memory_apply_patch #then it is settled first and the patch commits", async () => {
    // #given
    const repo = await afterStagedFailure(CREATE_NEW)

    // #when
    const result = await runMemoryApplyPatch({
      repo,
      lock,
      params: { reason: "patch after unlock", author: AUTHOR, input: ["*** Begin Patch", "*** Add File: system/other.md", "+---", "+description: Other", "+---", "+other fact", "*** End Patch"].join("\n") },
    })

    // #then
    expect(result.commit?.affectedPaths).toEqual(["system/other.md"])
    expect(await repo.status()).toBe("")
    expect(existsSync(join(repo.dir, "system", "new.md"))).toBe(false)
  })

  it("#given a pending rollback #when GitMemoryRepo.commitWrite runs directly #then it is settled first and only the new path commits", async () => {
    // #given
    const repo = await afterStagedFailure(CREATE_NEW)
    await writeOther(repo)

    // #when
    await repo.commitWrite(["system/other.md"], "direct write after unlock", AUTHOR)

    // #then
    expect(await repo.lsTree("HEAD")).not.toContain("system/new.md")
    expect(await repo.status()).toBe("")
  })

  it("#given a pending rollback #when GitMemoryRepo.commitPrepared runs on its own staged path #then it is settled first and only that path commits", async () => {
    // #given
    const repo = await afterStagedFailure(CREATE_NEW)
    await writeOther(repo)
    await git(repo.dir, ["add", "--", "system/other.md"])

    // #when
    await repo.commitPrepared(["system/other.md"], "prepared write after unlock", AUTHOR)

    // #then
    expect(await repo.lsTree("HEAD")).not.toContain("system/new.md")
    expect(await repo.status()).toBe("")
  })

  it("#given a new file written again by hand after the failure #when the next write settles the rollback #then the hand-written file survives and is reported", async () => {
    // #given
    const repo = await afterStagedFailure(CREATE_NEW)
    const handWritten = renderMemoryFile({ description: "Mine" }, "my own words\n")
    await writeFile(join(repo.dir, "system", "new.md"), handWritten, "utf8")

    // #when
    const failure = await runMemoryTool({ repo, lock, params: { ...CREATE_NEW, file_path: "system/other.md", reason: "next write" } }).catch((error: unknown) => error)

    // #then
    expect(keptPaths(failure)).toEqual(["system/new.md"])
    expect(await readFile(join(repo.dir, "system", "new.md"), "utf8")).toBe(handWritten)
    expect(await repo.status()).toBe("?? system/new.md\n")
  })

  it("#given a committed file edited by hand after a failed str_replace #when the next write settles the rollback #then the edit survives unstaged and is reported", async () => {
    // #given
    const repo = await afterStagedFailure(
      { command: "str_replace", reason: "edit behind a commit-time lock", file_path: "system/facts.md", old_string: "old fact", new_string: "tool fact", author: AUTHOR },
      "system/facts.md",
    )
    const edited = renderMemoryFile({ description: "Seed" }, "hand edit\n")
    await writeFile(join(repo.dir, "system", "facts.md"), edited, "utf8")

    // #when
    const failure = await runMemoryTool({ repo, lock, params: { ...CREATE_NEW, file_path: "system/other.md", reason: "next write" } }).catch((error: unknown) => error)

    // #then
    expect(keptPaths(failure)).toEqual(["system/facts.md"])
    expect(await readFile(join(repo.dir, "system", "facts.md"), "utf8")).toBe(edited)
    expect(await repo.status()).toBe(" M system/facts.md\n")
  })
})
