import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DirtyRepoError,
  GitMemoryRepo,
  NoEffectiveChangesError,
  createNodeGitExec,
} from "./index"

const tempDirs: string[] = []

async function createRepo(agentId = "agent-one") {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-git-")))
  tempDirs.push(dir)
  return { dir, repo: new GitMemoryRepo({ dir, agentId }) }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("GitMemoryRepo", () => {
  it("#given a committed HEAD with a fixed committer date #when timestamp is read #then epoch seconds are returned", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "initial\n" }] })
    const committedAt = "2026-08-10T00:00:00.000Z"
    const exec = createNodeGitExec()
    await exec.run(["commit", "--amend", "--no-edit"], {
      cwd: dir,
      timeoutMs: 30_000,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: committedAt,
        GIT_COMMITTER_DATE: committedAt,
      },
    })

    // when
    const timestamp = await repo.headCommitTimestamp()

    // then
    expect(timestamp).toBe(Date.parse(committedAt) / 1000)
  })

  it("#given a new repository #when it is initialized and a write is committed #then HEAD advances to the committed content", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "initial\n" }] })

    // when
    await writeFile(join(dir, "system/persona.md"), "updated\n")
    const result = await repo.commitWrite(["system/persona.md"], "remember update", {
      agentId: "agent-one",
      authorName: "Memory Agent",
    })

    // then
    expect(result.sha).toMatch(/^[0-9a-f]{40,64}$/)
    expect(result.sha).not.toBe(initial)
    expect(await repo.head()).toBe(result.sha)
    expect(await repo.show("HEAD", "system/persona.md")).toBe("updated\n")
    expect(await repo.lsTree()).toEqual(["system/persona.md"])
  })

  it("#given no effective path changes #when commitWrite runs #then it throws a typed no-change error", async () => {
    // given
    const { repo } = await createRepo()
    await repo.init({ seedFiles: [{ relativePath: "memory.md", content: "same\n" }] })

    // when
    const operation = repo.commitWrite(["memory.md"], "no-op", {
      agentId: "agent-one",
      authorName: "Memory Agent",
    })

    // then
    expect(await rejectedError(operation)).toBeInstanceOf(NoEffectiveChangesError)
  })

  it("#given unrelated uncommitted files #when cleanCheck runs #then it rejects with the porcelain listing", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init()
    await writeFile(join(dir, "dirty.md"), "dirty\n")

    // when
    const operation = repo.cleanCheck()

    // then
    const error = await rejectedError(operation)
    expect(error).toBeInstanceOf(DirtyRepoError)
    expect(error.message).toContain("?? dirty.md")
  })

  it("#given a UTF-16 markdown file is dirty #when cleanCheck runs #then its encoding problem is readable", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init()
    await writeFile(join(dir, "utf16.md"), Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))

    // when
    const operation = repo.cleanCheck()

    // then
    expect((await rejectedError(operation)).message).toContain("utf16.md has UTF-16 LE BOM")
  })

  it("#given local identity overrides #when init reconciles config #then email is preserved and agent identity is updated", async () => {
    // given
    const { dir } = await createRepo("old-agent")
    const exec = createNodeGitExec()
    await exec.run(["init"], { cwd: dir, timeoutMs: 30_000 })
    await exec.run(["config", "--local", "user.email", "operator@example.com"], { cwd: dir, timeoutMs: 30_000 })
    await exec.run(["config", "--local", "user.name", "Operator"], { cwd: dir, timeoutMs: 30_000 })
    await exec.run(["config", "--local", "omo.agentId", "old-agent"], { cwd: dir, timeoutMs: 30_000 })
    const repo = new GitMemoryRepo({ dir, agentId: "new-agent" })

    // when
    await repo.init()

    // then
    expect(await repo.configGet("user.email")).toBe("operator@example.com")
    expect(await repo.configGet("user.name")).toBe("Operator")
    expect(await repo.configGet("omo.agentId")).toBe("new-agent")
    expect(await repo.configGet("commit.gpgsign")).toBe("false")
    expect(await repo.configGet("gc.auto")).toBe("0")
  })

  it("#given commit signing is explicitly enabled locally #when init reconciles config #then the override is preserved", async () => {
    // given
    const { dir } = await createRepo()
    const exec = createNodeGitExec()
    await exec.run(["init"], { cwd: dir, timeoutMs: 30_000 })
    await exec.run([
      "-c", "user.name=Bootstrap", "-c", "user.email=bootstrap@example.com",
      "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "bootstrap",
    ], { cwd: dir, timeoutMs: 30_000 })
    await exec.run(["config", "--local", "commit.gpgsign", "true"], { cwd: dir, timeoutMs: 30_000 })
    const repo = new GitMemoryRepo({ dir, agentId: "agent-one" })

    // when
    await repo.init()

    // then
    expect(await repo.configGet("commit.gpgsign")).toBe("true")
  })

  it("#given conflicting local identity #when a tool write commits #then explicit author flags control attribution", async () => {
    // given
    const { dir, repo } = await createRepo()
    await repo.init()
    await repo.configSet("user.name", "Wrong Local Name")
    await repo.configSet("user.email", "wrong@example.com")
    await writeFile(join(dir, "fact.md"), "fact\n")

    // when
    await repo.commitWrite(["fact.md"], "remember fact", {
      agentId: "agent-one",
      authorName: "Correct Agent",
    })

    // then
    const exec = createNodeGitExec()
    const log = await exec.run(["log", "-1", "--format=%an <%ae>"], { cwd: dir, timeoutMs: 30_000 })
    expect(log.stdout.trim()).toBe("Correct Agent <agent-one@omo.local>")
    expect(await readFile(join(dir, "fact.md"), "utf8")).toBe("fact\n")
  })

  it("#given commits with bodies and changed paths #when log reads history #then metadata trailers ranges filters and optional paths are parsed newest-first", async () => {
    // given
    const { dir, repo } = await createRepo()
    const initial = await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "initial\n" }] })
    await writeFile(join(dir, "system/persona.md"), "updated\n")
    const first = await repo.commitWrite(
      ["system/persona.md"],
      "remember persona\n\nContext: durable\nOmo-Writer: memory-tool\nOmo-Session: session-1\nOmo-Turn: 2",
      { agentId: "agent-one", authorName: "Memory Agent", authorEmail: "memory@example.test" },
    )
    await writeFile(join(dir, "notes.md"), "note\n")
    const second = await repo.commitWrite(
      ["notes.md"],
      "remember note\n\nOmo-Writer: memory-tool\nOmo-Session: session-2\nOmo-Turn: 4",
      { agentId: "agent-one", authorName: "Memory Agent", authorEmail: "memory@example.test" },
    )

    // when
    const history = await repo.log({ range: `${initial}..HEAD`, includePaths: true })
    const filtered = await repo.log({ paths: ["system/persona.md"], limit: 1 })

    // then
    expect(history.map((commit) => commit.sha)).toEqual([second.sha, first.sha])
    expect(history[0]).toEqual(expect.objectContaining({
      subject: "remember note",
      authorName: "Memory Agent",
      authorEmail: "memory@example.test",
      committedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      trailers: { "Omo-Writer": "memory-tool", "Omo-Session": "session-2", "Omo-Turn": "4" },
      paths: ["notes.md"],
    }))
    expect(history[1]?.body).toContain("Context: durable")
    expect(history[1]?.trailers).toEqual({
      Context: "durable",
      "Omo-Writer": "memory-tool",
      "Omo-Session": "session-1",
      "Omo-Turn": "2",
    })
    expect(history[1]?.paths).toEqual(["system/persona.md"])
    expect(filtered.map((commit) => commit.sha)).toEqual([first.sha])
    expect(filtered[0]?.paths).toBeUndefined()
  })

  it("#given a reflection worktree commit #when it is merged no-ff #then the parent exposes the content and removes the worktree", async () => {
    // given
    const { repo } = await createRepo()
    await repo.init()
    const worktreeParent = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-worktree-")))
    tempDirs.push(worktreeParent)
    const worktreeDir = join(worktreeParent, "checkout")
    await repo.worktreeAdd(worktreeDir, "memory/reflection-test")
    const childRepo = new GitMemoryRepo({ dir: worktreeDir, agentId: "agent-one" })
    await writeFile(join(worktreeDir, "learned.md"), "learned\n")
    await childRepo.commitWrite(["learned.md"], "learn in reflection", {
      agentId: "agent-one",
      authorName: "Reflection Agent",
    })

    // when
    const mergedHead = await repo.merge("memory/reflection-test", {
      noFF: true,
      message: "merge(reflection): test",
    })
    await repo.worktreeRemove(worktreeDir)

    // then
    expect(await repo.head()).toBe(mergedHead)
    expect(await repo.show("HEAD", "learned.md")).toBe("learned\n")
    expect(existsSync(worktreeDir)).toBe(false)
  })
})

async function rejectedError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected Error rejection, received ${String(error)}`)
  }
  throw new Error("Expected operation to reject")
}
