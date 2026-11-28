import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { renderMemoryFile } from "../memfs/frontmatter"
import { removeTree } from "../../../../test-support/remove-tree"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { runMemoryTool, type MemoryToolLock } from "./memory"

// #15411: a write whose commit fails without landing (a hook crash, a commit timeout that did not land, a full disk) must
// leave the tree as it found it. Before the fix the edit stayed staged and every later write was refused as "uncommitted".

const AUTHOR: GitCommitAuthor = { agentId: "agent-failed-commit", authorName: "Failed Commit" }
const lock: MemoryToolLock = async (_domain, operation) => operation()

class CommitFailsOnceRepo extends GitMemoryRepo {
  failNext = false

  override async commitPrepared(
    ...args: Parameters<GitMemoryRepo["commitPrepared"]>
  ): ReturnType<GitMemoryRepo["commitPrepared"]> {
    if (this.failNext) {
      this.failNext = false
      throw new Error("git commit exited 1 (simulated hook failure)")
    }
    return super.commitPrepared(...args)
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<CommitFailsOnceRepo> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-failed-commit-")))
  roots.push(root)
  const repo = new CommitFailsOnceRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  return repo
}

async function seed(repo: GitMemoryRepo, path: string, text: string): Promise<void> {
  const full = join(repo.dir, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, renderMemoryFile({ description: "Seed" }, text), "utf8")
  await repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

function create(repo: GitMemoryRepo, path: string, reason: string) {
  return runMemoryTool({
    repo,
    lock,
    params: { command: "create", reason, file_path: path, description: "Fact", file_text: "a fact", author: AUTHOR },
  })
}

describe("a memory write whose commit fails without landing (#15411)", () => {
  it("#given a create whose commit fails #when the next write runs #then the failed file is gone and the next write commits", async () => {
    // given
    const repo = await fixture()
    repo.failNext = true

    // when
    const failure = await create(repo, "notes/d.md", "write that fails").catch((error: unknown) => error)
    const next = await create(repo, "notes/e.md", "write after the failure")

    // then
    expect(String(failure)).toContain("simulated hook failure")
    expect(existsSync(join(repo.dir, "notes", "d.md"))).toBe(false)
    expect(next.commit?.affectedPaths).toEqual(["notes/e.md"])
    expect(await repo.status()).toBe("")
  })

  it("#given a str_replace on a committed file whose commit fails #then the file is back to its HEAD content", async () => {
    // given
    const repo = await fixture()
    await seed(repo, "system/facts.md", "old fact\n")
    const atHead = await readFile(join(repo.dir, "system", "facts.md"), "utf8")
    repo.failNext = true

    // when
    await runMemoryTool({
      repo,
      lock,
      params: {
        command: "str_replace",
        reason: "edit that fails",
        file_path: "system/facts.md",
        old_string: "old fact",
        new_string: "new fact",
        author: AUTHOR,
      },
    }).catch(() => undefined)

    // then
    expect(await readFile(join(repo.dir, "system", "facts.md"), "utf8")).toBe(atHead)
    expect(await repo.status()).toBe("")
  })

  it("#given a memory_apply_patch whose commit fails #then no patched or added file stays behind", async () => {
    // given
    const repo = await fixture()
    await seed(repo, "system/facts.md", "old fact\n")
    const atHead = await readFile(join(repo.dir, "system", "facts.md"), "utf8")
    repo.failNext = true
    const input = [
      "*** Begin Patch",
      "*** Update File: system/facts.md",
      "@@",
      "-old fact",
      "+new fact",
      "*** Add File: notes/added.md",
      "+---",
      "+description: Added",
      "+---",
      "+added fact",
      "*** End Patch",
    ].join("\n")

    // when
    const failure = await runMemoryApplyPatch({ repo, lock, params: { reason: "patch that fails", input, author: AUTHOR } }).catch(
      (error: unknown) => error,
    )

    // then
    expect(String(failure)).toContain("simulated hook failure")
    expect(await readFile(join(repo.dir, "system", "facts.md"), "utf8")).toBe(atHead)
    expect(existsSync(join(repo.dir, "notes", "added.md"))).toBe(false)
    expect(await repo.status()).toBe("")
  })
})
