import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, inspectStrandedGitLock, unlockStrandedGitLock, type GitCommitAuthor, type UnlockScans } from "../git"
import { restoreWorktreeFromHead } from "../git/worktree-restore"
import { renderMemoryFile } from "../memfs/frontmatter"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { removeTree } from "../../../../test-support/remove-tree"

// omo #10199: a memory write that fails behind a kept stranded git lock must leave the working
// tree exactly as it found it, so the retry after /memory unlock lands. The failed `git add`
// never touched the index, so only the files this write produced are put back, from HEAD.

setDefaultTimeout(90_000)

const AUTHOR: GitCommitAuthor = { agentId: "agent-stranded-lock-write", authorName: "Stranded Lock Write" }
const NOBODY: UnlockScans = { findHolders: async () => [], findRepoUsers: async () => [] }

class IndexLockAtCommitRepo extends GitMemoryRepo {
  override async commitPrepared(...args: Parameters<GitMemoryRepo["commitPrepared"]>): ReturnType<GitMemoryRepo["commitPrepared"]> {
    await writeFile(join(this.dir, ".git", "index.lock"), "", "utf8")
    return super.commitPrepared(...args)
  }
}

class HeadUnreadableRepo extends GitMemoryRepo {
  override show(): Promise<string> {
    return Promise.reject(new Error("HEAD is unreadable in this test"))
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{ repo: GitMemoryRepo; lock: MemoryToolLock; lockPath: string }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-stranded-write-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const lock: MemoryToolLock = async (_domain, operation) => operation()
  return { repo, lock, lockPath: join(repo.dir, ".git", "index.lock") }
}

async function seed(repo: GitMemoryRepo, path: string, text: string): Promise<void> {
  const full = join(repo.dir, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, renderMemoryFile({ description: "Seed" }, text), "utf8")
  await repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

function create(setup: Awaited<ReturnType<typeof fixture>>, path: string, text: string, reason: string) {
  return runMemoryTool({
    repo: setup.repo,
    lock: setup.lock,
    params: { command: "create", reason, file_path: path, description: "Fact", file_text: text, author: AUTHOR },
  })
}

describe("a memory write behind a kept stranded git lock (omo #10199)", () => {
  it("#given a kept index.lock #when a create fails #then the new file is gone and the repository is clean apart from the lock", async () => {
    // #given
    const setup = await fixture()
    await writeFile(setup.lockPath, "", "utf8")

    // #when
    const failure = await create(setup, "system/new.md", "new fact", "write behind the lock").catch((error: unknown) => error)

    // #then
    expect(String(failure)).toContain("/memory unlock")
    expect(existsSync(join(setup.repo.dir, "system", "new.md"))).toBe(false)
    expect(await setup.repo.status()).toBe("")
    expect(existsSync(setup.lockPath)).toBe(true)
  })

  it("#given a kept index.lock #when a str_replace on a committed file fails #then the file is back to its HEAD content", async () => {
    // #given
    const setup = await fixture()
    await seed(setup.repo, "system/facts.md", "old fact\n")
    const atHead = await readFile(join(setup.repo.dir, "system", "facts.md"), "utf8")
    await writeFile(setup.lockPath, "", "utf8")

    // #when
    await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: { command: "str_replace", reason: "edit behind the lock", file_path: "system/facts.md", old_string: "old fact", new_string: "new fact", author: AUTHOR },
    }).catch(() => undefined)

    // #then
    expect(await readFile(join(setup.repo.dir, "system", "facts.md"), "utf8")).toBe(atHead)
    expect(await setup.repo.status()).toBe("")
  })

  it("#given a write failed behind a kept lock #when the lock is unlocked the way the user does #then the same write retried commits", async () => {
    // #given
    const setup = await fixture()
    await writeFile(setup.lockPath, "", "utf8")
    await create(setup, "system/new.md", "new fact", "write behind the lock").catch(() => undefined)

    // #when
    const inspection = await inspectStrandedGitLock(setup.repo.dir, setup.lockPath, NOBODY)
    if (inspection.kind !== "found") throw new Error(`unexpected ${inspection.kind}`)
    expect(inspection.verdict).toBe("confirm")
    expect((await unlockStrandedGitLock(setup.repo.dir, inspection, NOBODY)).kind).toBe("removed")
    const retried = await create(setup, "system/new.md", "new fact", "write after unlock")

    // #then
    expect(retried.commit?.affectedPaths).toEqual(["system/new.md"])
    expect(await setup.repo.status()).toBe("")
  })

  it("#given a kept ref lock that lets git add succeed #when a create fails at commit and the lock is unlocked #then the index and tree are clean and the retry commits", async () => {
    // #given
    const setup = await fixture()
    const refLock = join(setup.repo.dir, ".git", "refs", "heads", "main.lock")
    await writeFile(refLock, "", "utf8")

    // #when
    const failure = await create(setup, "system/new.md", "new fact", "write behind the ref lock").catch((error: unknown) => error)
    const statusAfterFailure = await setup.repo.status()
    const inspection = await inspectStrandedGitLock(setup.repo.dir, refLock, NOBODY)
    if (inspection.kind !== "found") throw new Error(`unexpected ${inspection.kind}`)
    expect((await unlockStrandedGitLock(setup.repo.dir, inspection, NOBODY)).kind).toBe("removed")
    const retried = await create(setup, "system/new.md", "new fact", "write after unlock")

    // #then
    expect(String(failure)).toContain("/memory unlock")
    expect(statusAfterFailure).toBe("")
    expect(retried.commit?.affectedPaths).toEqual(["system/new.md"])
  })

  it("#given index.lock appears after git add #when the commit fails and the lock is unlocked #then the next write unstages this write first and commits", async () => {
    // #given
    const setup = await fixture()
    const lockedAtCommit = new IndexLockAtCommitRepo({ dir: setup.repo.dir, agentId: AUTHOR.agentId })

    // #when
    const failure = await runMemoryTool({
      repo: lockedAtCommit,
      lock: setup.lock,
      params: { command: "create", reason: "write behind a commit-time lock", file_path: "system/new.md", description: "Fact", file_text: "new fact", author: AUTHOR },
    }).catch((error: unknown) => error)
    const inspection = await inspectStrandedGitLock(setup.repo.dir, setup.lockPath, NOBODY)
    if (inspection.kind !== "found") throw new Error(`unexpected ${inspection.kind}`)
    expect((await unlockStrandedGitLock(setup.repo.dir, inspection, NOBODY)).kind).toBe("removed")
    const retried = await create(setup, "system/other.md", "other fact", "write after unlock")

    // #then
    expect(String(failure)).toContain("/memory unlock")
    expect(String(failure)).toContain("still staged")
    expect(retried.commit?.affectedPaths).toEqual(["system/other.md"])
    expect(await setup.repo.status()).toBe("")
    expect(existsSync(join(setup.repo.dir, "system", "new.md"))).toBe(false)
  })

  it("#given the restore itself cannot read HEAD #when the write fails behind the lock #then both errors are reported and the lock is kept", async () => {
    // #given
    const setup = await fixture()
    await seed(setup.repo, "system/facts.md", "old fact\n")
    const broken = new HeadUnreadableRepo({ dir: setup.repo.dir, agentId: AUTHOR.agentId })
    await writeFile(setup.lockPath, "", "utf8")

    // #when
    const failure = await runMemoryTool({
      repo: broken,
      lock: setup.lock,
      params: { command: "str_replace", reason: "edit behind the lock", file_path: "system/facts.md", old_string: "old fact", new_string: "new fact", author: AUTHOR },
    }).catch((error: unknown) => error)

    // #then
    const message = String(failure)
    expect(message).toContain("/memory unlock")
    expect(message).toContain("could not be undone")
    expect(existsSync(setup.lockPath)).toBe(true)
  })
})

describe("restoreWorktreeFromHead (omo #10199)", () => {
  it("#given an unrelated dirty file #when only the write's own paths are restored #then the unrelated change survives", async () => {
    // #given
    const setup = await fixture()
    await seed(setup.repo, "system/facts.md", "old fact\n")
    await seed(setup.repo, "system/other.md", "other\n")
    await writeFile(join(setup.repo.dir, "system", "facts.md"), "changed by the write", "utf8")
    await writeFile(join(setup.repo.dir, "system", "new.md"), "created by the write", "utf8")
    await writeFile(join(setup.repo.dir, "system", "other.md"), "someone else's uncommitted work", "utf8")

    // #when
    await restoreWorktreeFromHead(setup.repo, ["system/facts.md", "system/new.md"])

    // #then
    expect(await readFile(join(setup.repo.dir, "system", "facts.md"), "utf8")).toContain("old fact")
    expect(existsSync(join(setup.repo.dir, "system", "new.md"))).toBe(false)
    expect(await readFile(join(setup.repo.dir, "system", "other.md"), "utf8")).toBe("someone else's uncommitted work")
  })
})
