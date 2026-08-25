import { afterEach, describe, expect, it } from "bun:test"
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, GitPathStateError, createNodeGitExec } from "./index"

const AUTHOR = { agentId: "path-state-agent", authorName: "Path State Agent" }
const tempDirs: string[] = []

async function fixture(seedFiles: Array<{ relativePath: string; content: string }> = []) {
  const dir = await mkdtemp(join(tmpdir(), "memory-path-state-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName, seedFiles })
  return { dir, repo }
}

async function git(dir: string, argv: readonly string[]) {
  const result = await createNodeGitExec().run(argv, { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

async function rejectedError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error("Expected operation to reject")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })))
})

describe("GitPathStateStore", () => {
  it("captures stage-zero index and raw worktree identities independently", async () => {
    const { dir, repo } = await fixture([{ relativePath: "tracked.md", content: "base\n" }])

    const clean = await repo.pathState.capture("tracked.md")
    const missing = await repo.pathState.capture("missing.md")
    const captured = await repo.pathState.captureAll(["tracked.md", "missing.md", "tracked.md"])
    await writeFile(join(dir, "tracked.md"), "worktree\n")
    const worktreeDirty = await repo.pathState.capture("tracked.md")
    await git(dir, ["add", "--", "tracked.md"])
    await writeFile(join(dir, "tracked.md"), "third\n")
    const bothDirty = await repo.pathState.capture("tracked.md")

    expect(clean.index).toEqual({ mode: "100644", oid: clean.worktree.kind === "file" ? clean.worktree.oid : "" })
    expect(missing).toEqual({ index: null, worktree: { kind: "missing" } })
    expect([...captured.keys()]).toEqual(["tracked.md", "missing.md"])
    expect(captured.get("tracked.md")).toEqual(clean)
    expect(worktreeDirty.index).toEqual(clean.index)
    expect(worktreeDirty.worktree).not.toEqual(clean.worktree)
    expect(bothDirty.index).not.toEqual(clean.index)
    expect(bothDirty.worktree).not.toEqual(worktreeDirty.worktree)
  })

  // Windows has no POSIX executable bit and git reports core.filemode=false there, so a chmod-only
  // change is not a diff at all: the commit correctly raises NoEffectiveChangesError. The behaviour
  // under test is real but POSIX-only, matching the repo's existing skipIf convention for
  // platform-specific process and filesystem semantics.
  it.skipIf(process.platform === "win32")("captures and restores executable modes", async () => {
    const { dir, repo } = await fixture([{ relativePath: "script.sh", content: "#!/bin/sh\n" }])
    await chmod(join(dir, "script.sh"), 0o755)
    await repo.commitWrite(["script.sh"], "make executable", AUTHOR)

    const state = await repo.pathState.capture("script.sh")
    expect(state.index?.mode).toBe("100755")
    expect(state.worktree.kind === "file" ? state.worktree.mode : 0).toBe(0o755)

    await chmod(join(dir, "script.sh"), 0o644)
    if (state.worktree.kind !== "file") throw new Error("expected file")
    await repo.pathState.writeWorktree("script.sh", state.worktree)
    expect((await lstat(join(dir, "script.sh"))).mode & 0o777).toBe(0o755)
  })

  it("hashes and writes blobs both raw and through path filters", async () => {
    const { dir, repo } = await fixture([{ relativePath: ".gitattributes", content: "*.txt text eol=lf\n" }])
    const content = "unique-filtered-content\r\n"

    const rawUnwritten = await repo.pathState.hashWorktreeBlob(content)
    expect((await createNodeGitExec().run(["cat-file", "-e", rawUnwritten], {
      cwd: dir,
      timeoutMs: 30_000,
    })).code).not.toBe(0)

    const raw = await repo.pathState.hashWorktreeBlob(content, true)
    const filtered = await repo.pathState.hashIndexBlob("filtered.txt", content, true)
    await writeFile(join(dir, "filtered.txt"), content)
    await git(dir, ["add", "--", "filtered.txt"])
    const captured = await repo.pathState.capture("filtered.txt")

    expect(raw).toBe(rawUnwritten)
    expect(filtered).not.toBe(raw)
    expect(captured.index?.oid).toBe(filtered)
    expect(captured.worktree.kind === "file" ? captured.worktree.oid : "").toBe(raw)
    expect(await repo.pathState.readBlob(raw)).toBe(content)
    expect(await repo.pathState.readBlob(filtered)).toBe("unique-filtered-content\n")
  })

  it("sets and removes index entries without changing the worktree", async () => {
    const { dir, repo } = await fixture([{ relativePath: "entry.md", content: "base\n" }])
    const before = await repo.pathState.capture("entry.md")
    const replacement = await repo.pathState.hashIndexBlob("entry.md", "index-only\n", true)

    await repo.pathState.setIndex("entry.md", { mode: "100644", oid: replacement })
    const changed = await repo.pathState.capture("entry.md")
    expect(changed.index?.oid).toBe(replacement)
    expect(changed.worktree).toEqual(before.worktree)

    if (before.index === null) throw new Error("expected index entry")
    await repo.pathState.setIndex("entry.md", before.index)
    expect(await repo.pathState.capture("entry.md")).toEqual(before)

    await repo.pathState.removeIndex("entry.md")
    expect((await repo.pathState.capture("entry.md")).index).toBeNull()
    expect(await readFile(join(dir, "entry.md"), "utf8")).toBe("base\n")
  })

  it("atomically materializes and removes worktree files idempotently", async () => {
    const { dir, repo } = await fixture()
    const oid = await repo.pathState.hashWorktreeBlob("materialized\n", true)
    const identity = { kind: "file" as const, mode: 0o640, oid }

    await repo.pathState.writeWorktree("nested/a b.md", identity)
    await repo.pathState.writeWorktree("nested/a b.md", identity)
    expect(await readFile(join(dir, "nested/a b.md"), "utf8")).toBe("materialized\n")
    // The exact mode round-trips on POSIX; Windows applies a umask, so 0o640 can surface as 0o666
    // there and this assertion is POSIX-scoped rather than asserting semantics the platform lacks.
    if (process.platform !== "win32") expect((await lstat(join(dir, "nested/a b.md"))).mode & 0o777).toBe(0o640)

    await repo.pathState.removeWorktree("nested/a b.md")
    await repo.pathState.removeWorktree("nested/a b.md")
    expect((await repo.pathState.capture("nested/a b.md")).worktree).toEqual({ kind: "missing" })
  })

  it("rejects traversal, worktree symlinks, and index symlinks", async () => {
    const { dir, repo } = await fixture()
    await symlink("target", join(dir, "link.md"))

    expect(await rejectedError(repo.pathState.capture("../outside.md"))).toBeInstanceOf(GitPathStateError)
    expect(await rejectedError(repo.pathState.capture("C:\\outside.md"))).toBeInstanceOf(GitPathStateError)
    expect(await rejectedError(repo.pathState.capture("nested/.git/config"))).toBeInstanceOf(GitPathStateError)
    expect(await rejectedError(repo.pathState.capture("link.md"))).toBeInstanceOf(GitPathStateError)

    await git(dir, ["add", "--", "link.md"])
    expect(await rejectedError(repo.pathState.capture("link.md"))).toBeInstanceOf(GitPathStateError)
  })

  it("rejects unmerged entries", async () => {
    const { dir, repo } = await fixture([{ relativePath: "conflict.md", content: "base\n" }])
    await git(dir, ["checkout", "-b", "other"])
    await writeFile(join(dir, "conflict.md"), "other\n")
    await git(dir, ["add", "--", "conflict.md"])
    await git(dir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "other"])
    await git(dir, ["checkout", "main"])
    await writeFile(join(dir, "conflict.md"), "main\n")
    await git(dir, ["add", "--", "conflict.md"])
    await git(dir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "main"])
    const merge = await createNodeGitExec().run(["merge", "other"], { cwd: dir, timeoutMs: 30_000 })
    expect(merge.code).not.toBe(0)

    const error = await rejectedError(repo.pathState.capture("conflict.md"))
    expect(error).toBeInstanceOf(GitPathStateError)
    expect(error.message).toContain("unmerged")
  })

  it("rejects unsupported index modes", async () => {
    const { dir, repo } = await fixture()
    const head = await repo.head()
    if (head === null) throw new Error("expected HEAD")
    await git(dir, ["update-index", "--add", "--cacheinfo", "160000", head, "submodule"])

    const error = await rejectedError(repo.pathState.capture("submodule"))
    expect(error).toBeInstanceOf(GitPathStateError)
    expect(error.message).toContain("160000")
  })
})
