import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, MemorySecretError, createNodeGitExec } from "./index"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []
const AUTHOR = { agentId: "agent-one", authorName: "Memory Agent" }

async function createRepo() {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-git-secret-")))
  tempDirs.push(dir)
  return { dir, repo: new GitMemoryRepo({ dir, agentId: "agent-one" }) }
}

async function rejectedError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected Error rejection, received ${String(error)}`)
  }
  throw new Error("Expected operation to reject")
}

async function write(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content)
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTree(dir, { maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

setDefaultTimeout(process.platform === "win32" ? 30_000 : 15_000)

describe("GitMemoryRepo secret screening", () => {
  it("#given a file carrying an aws key #when commitWrite runs #then it refuses with path and class, HEAD stays and the file survives", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init()
    await write(dir, "reference/x.md", "the key is AKIAABCDEFGHIJKLMNOP\n")

    // when
    const error = await rejectedError(repo.commitWrite(["reference/x.md"], "remember key", AUTHOR))

    // then
    expect(error).toBeInstanceOf(MemorySecretError)
    const secret = error as MemorySecretError
    expect(secret.path).toBe("reference/x.md")
    expect(secret.patternClass).toBe("aws_access_key")
    expect(secret.where).toBe("content")
    expect(secret.message).not.toContain("AKIAABCDEFGHIJKLMNOP")
    expect(await repo.head()).toBe(initial)
    expect(await readFile(join(dir, "reference/x.md"), "utf8")).toBe("the key is AKIAABCDEFGHIJKLMNOP\n")
  })

  it("#given a secret-bearing staged blob overwritten in the worktree #when commitPrepared runs #then it refuses because the index is scanned, not the worktree", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init()
    const exec = createNodeGitExec()
    await write(dir, "reference/x.md", "token=abc123456\n")
    await exec.run(["add", "-A", "--", "reference/x.md"], { cwd: dir, timeoutMs: 30_000 })
    await write(dir, "reference/x.md", "clean body\n")

    // when
    const error = await rejectedError(repo.commitPrepared(["reference/x.md"], "remember x", AUTHOR))

    // then
    expect(error).toBeInstanceOf(MemorySecretError)
    expect((error as MemorySecretError).patternClass).toBe("credential_assignment")
    expect(await repo.head()).toBe(initial)
  })

  it("#given a clean staged blob with a secret only in the worktree #when commitPrepared runs #then the clean index commits", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init()
    const exec = createNodeGitExec()
    await write(dir, "reference/x.md", "clean body\n")
    await exec.run(["add", "-A", "--", "reference/x.md"], { cwd: dir, timeoutMs: 30_000 })
    await write(dir, "reference/x.md", "token=abc123456\n")

    // when
    const result = await repo.commitPrepared(["reference/x.md"], "remember x", AUTHOR)

    // then
    expect(await repo.head()).toBe(result.sha)
    expect(await repo.show("HEAD", "reference/x.md")).toBe("clean body\n")
  })

  it("#given a staged deletion #when commitPrepared runs #then the deletion commits without reading a missing blob", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init({ seedFiles: [{ relativePath: "reference/x.md", content: "x\n" }] })
    const exec = createNodeGitExec()
    await exec.run(["rm", "-q", "reference/x.md"], { cwd: dir, timeoutMs: 30_000 })

    // when
    const result = await repo.commitPrepared(["reference/x.md"], "remove x", AUTHOR)

    // then
    expect(await repo.head()).toBe(result.sha)
    expect(await repo.lsTree()).not.toContain("reference/x.md")
  })

  it("#given a staged rename #when commitPrepared runs #then the rename commits", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init({ seedFiles: [{ relativePath: "reference/old.md", content: "old body\n" }] })
    const exec = createNodeGitExec()
    await exec.run(["mv", "reference/old.md", "reference/new.md"], { cwd: dir, timeoutMs: 30_000 })

    // when
    const result = await repo.commitPrepared(["reference/old.md", "reference/new.md"], "rename old", AUTHOR)

    // then
    expect(await repo.head()).toBe(result.sha)
    expect(await repo.lsTree()).toContain("reference/new.md")
    expect(await repo.lsTree()).not.toContain("reference/old.md")
  })

  it("#given a secret-like file name with a clean body #when commitWrite runs #then it refuses as a path hit and the name's digits never appear", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init()
    await write(dir, "reference/token=abc123456.md", "clean body\n")

    // when
    const error = await rejectedError(repo.commitWrite(["reference/token=abc123456.md"], "remember name", AUTHOR))

    // then
    expect(error).toBeInstanceOf(MemorySecretError)
    const secret = error as MemorySecretError
    expect(secret.where).toBe("path")
    expect(secret.patternClass).toBe("credential_assignment")
    expect(secret.message).not.toContain("abc123456")
    expect(await repo.head()).toBe(initial)
  })

  it("#given a clean file #when commitWrite runs #then it commits as before", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init()
    await write(dir, "reference/ok.md", "perfectly ordinary note\n")

    // when
    const result = await repo.commitWrite(["reference/ok.md"], "remember ok", AUTHOR)

    // then
    expect(await repo.head()).toBe(result.sha)
    expect(await repo.show("HEAD", "reference/ok.md")).toBe("perfectly ordinary note\n")
  })

  it("#given a refused staging of a new secret file #when restorePaths runs #then index and worktree both return to the pre-operation state", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init()
    await write(dir, "reference/new.md", "token=abc123456\n")
    await rejectedError(repo.commitWrite(["reference/new.md"], "remember new", AUTHOR))

    // when
    await repo.restorePaths(["reference/new.md"])

    // then
    expect(await repo.head()).toBe(initial)
    expect((await repo.status()).trim()).toBe("")
  })

  it("#given a refused staging over a tracked clean file #when restorePaths runs #then the tracked content is back in index and worktree", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init({ seedFiles: [{ relativePath: "reference/x.md", content: "clean body\n" }] })
    await write(dir, "reference/x.md", "token=abc123456\n")
    await rejectedError(repo.commitWrite(["reference/x.md"], "remember x", AUTHOR))

    // when
    await repo.restorePaths(["reference/x.md"])

    // then
    expect((await repo.status()).trim()).toBe("")
    expect((await readFile(join(dir, "reference/x.md"), "utf8")).replace(/\r\n/g, "\n")).toBe("clean body\n")
    expect(await repo.show("HEAD", "reference/x.md")).toBe("clean body\n")
  })
})
