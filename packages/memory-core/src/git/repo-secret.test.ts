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

  it.each(["reference/new.md", "reference/[x].md", ...(process.platform === "win32" ? [] : [":*.md", ":!*.md"])])("#given refused staging of new secret file %s #when restorePaths runs #then index and worktree both return to the pre-operation state", async (path) => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init({ seedFiles: [{ relativePath: "reference/x.md", content: "preserved body\n" }] })
    await write(dir, path, "token=abc123456\n")
    await rejectedError(repo.commitWrite([path], "remember new", AUTHOR))

    // when
    await repo.restorePaths([path])

    // then
    expect(await repo.head()).toBe(initial)
    expect((await repo.status()).trim()).toBe("")
    expect(await readFile(join(dir, "reference/x.md"), "utf8")).toBe("preserved body\n")
  })

  it.each(["reference/target.md", "reference/[x].md", ...(process.platform === "win32" ? [] : [":*.md", ":!*.md"])])("#given refused staging over tracked file %s #when restorePaths runs #then only its content is restored", async (path) => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init({ seedFiles: [
      { relativePath: path, content: "clean body\n" },
      { relativePath: "reference/x.md", content: "preserved body\n" },
    ] })
    await write(dir, path, "token=abc123456\n")
    await rejectedError(repo.commitWrite([path], "remember x", AUTHOR))
    await write(dir, "reference/x.md", "unrelated change\n")

    // when
    await repo.restorePaths([path])

    // then
    expect((await repo.status()).trim()).toBe("M reference/x.md")
    expect((await readFile(join(dir, path), "utf8")).replace(/\r\n/g, "\n")).toBe("clean body\n")
    expect(await repo.show("HEAD", path)).toBe("clean body\n")
    expect(await readFile(join(dir, "reference/x.md"), "utf8")).toBe("unrelated change\n")
  })

  it.each(["reference/[x].md", ...(process.platform === "win32" ? [] : [":*.md", ":!*.md"])])("#given staged literal path %s #when unstage runs #then its worktree and staged neighbor survive", async (path) => {
    for (const tracked of [true, false]) {
      // given
      const { dir, repo } = await createRepo()
      await repo.init({ seedFiles: [
        { relativePath: "reference/neighbor.md", content: "original neighbor\n" },
        ...(tracked ? [{ relativePath: path, content: "original target\n" }] : []),
      ] })
      await write(dir, path, "staged target\n")
      await write(dir, "reference/neighbor.md", "staged neighbor\n")
      const exec = createNodeGitExec()
      const staged = await exec.run(["--literal-pathspecs", "add", "--", path, "reference/neighbor.md"], { cwd: dir, timeoutMs: 30_000 })
      expect(staged.code).toBe(0)
      await write(dir, path, "unstaged target\n")

      // when
      await repo.unstage(tracked ? [path] : [], tracked ? [] : [path])

      // then
      const index = await exec.run(["diff", "--cached", "--name-only"], { cwd: dir, timeoutMs: 30_000 })
      expect(index.code).toBe(0)
      expect(index.stdout).toBe("reference/neighbor.md\n")
      const neighbor = await exec.run(["show", ":reference/neighbor.md"], { cwd: dir, timeoutMs: 30_000 })
      expect(neighbor.code).toBe(0)
      expect(neighbor.stdout).toBe("staged neighbor\n")
      expect(await readFile(join(dir, path), "utf8")).toBe("unstaged target\n")
      expect(await readFile(join(dir, "reference/neighbor.md"), "utf8")).toBe("staged neighbor\n")
      expect(await repo.status([path])).toBe(`${tracked ? " M" : "??"} ${path}\n`)
    }
  })
})
