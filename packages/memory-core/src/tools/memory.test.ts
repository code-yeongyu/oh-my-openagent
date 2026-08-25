import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs/frontmatter"
import { runMemoryTool, type MemoryToolLock, type MemoryToolParams } from "./memory"
import { MemoryToolError } from "./tool-errors"
import { realpathSync } from "node:fs"

const exec = promisify(execFile)
const AUTHOR: GitCommitAuthor = {
  agentId: "agent-memory-test",
  authorName: "Memory Test Agent",
  authorEmail: "memory-test@example.com",
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<{
  repo: GitMemoryRepo
  lock: MemoryToolLock
  domains: string[]
}> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-tool-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const domains: string[] = []
  const lock: MemoryToolLock = async (domain, operation) => {
    domains.push(domain)
    return operation()
  }
  return { repo, lock, domains }
}

async function run(
  setup: Awaited<ReturnType<typeof fixture>>,
  params: Omit<MemoryToolParams, "author">,
) {
  return runMemoryTool({ repo: setup.repo, lock: setup.lock, params: { ...params, author: AUTHOR } })
}

async function body(repo: GitMemoryRepo, path: string): Promise<string> {
  return parseMemoryFile(await readFile(join(repo.dir, path), "utf8")).body
}

async function seed(
  setup: Awaited<ReturnType<typeof fixture>>,
  path: string,
  text: string,
  readOnly?: string,
): Promise<void> {
  const fullPath = join(setup.repo.dir, path)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, renderMemoryFile({ description: "Seed", ...(readOnly ? { read_only: readOnly } : {}) }, text))
  await setup.repo.commitWrite([path], `seed ${path}`, AUTHOR)
}

async function git(repo: GitMemoryRepo, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: repo.dir })
  return String(result.stdout).trim()
}

setDefaultTimeout(process.platform === "win32" ? 30000 : 5000)

describe("runMemoryTool", () => {
  it("#given create params #when run #then it renders frontmatter, commits under the writer lock, and reports local", async () => {
    const setup = await fixture()
    const result = await run(setup, {
      command: "create", reason: "create profile", file_path: "system/profile.md",
      description: "User profile", file_text: "Name: Ada",
    })

    expect(parseMemoryFile(await readFile(join(setup.repo.dir, "system/profile.md"), "utf8"))).toEqual({
      frontmatter: { description: "User profile" }, body: "Name: Ada",
    })
    expect(result.message).toMatch(/^Memory create committed locally \([0-9a-f]{7}\)\.$/)
    expect(setup.domains).toEqual(["memory-write"])
    expect(await git(setup.repo, ["log", "-1", "--pretty=%s%n%an%n%ae"])).toBe(
      "create profile\nMemory Test Agent\nmemory-test@example.com",
    )
  })

  it("#given accepted-turn provenance #when memory commits #then the in-band writer session and turn trailers are durable", async () => {
    // given
    const setup = await fixture()

    // when
    await runMemoryTool({
      repo: setup.repo,
      lock: setup.lock,
      params: {
        command: "create",
        reason: "remember provenance",
        file_path: "provenance.md",
        description: "Provenance",
        author: AUTHOR,
        provenance: { sessionId: "session-provenance", userTurns: 7 },
      },
    })

    // then
    expect((await setup.repo.log({ limit: 1 }))[0]?.trailers).toEqual({
      "Omo-Writer": "memory-tool",
      "Omo-Session": "session-provenance",
      "Omo-Turn": "7",
    })
  })

  it("#given create omits optional file_text #when run #then an empty body is valid", async () => {
    const setup = await fixture()

    await run(setup, {
      command: "create", reason: "create empty note", file_path: "empty", description: "Empty note",
    })

    expect(await body(setup.repo, "empty.md")).toBe("")
  })

  it("#given a configured remote #when create commits #then the result delegates synchronization to the harness", async () => {
    const setup = await fixture()
    await setup.repo.configSet("remote.backup.url", "file:///tmp/memory-backup.git")

    const result = await run(setup, {
      command: "create", reason: "create remote note", file_path: "reference/note",
      description: "Note", file_text: "body",
    })

    expect(result.message).toMatch(/^Memory create committed \([0-9a-f]{7}\); harness will sync after the turn\.$/)
  })

  it("#given two matching body occurrences #when str_replace runs #then only the first occurrence changes", async () => {
    const setup = await fixture()
    await seed(setup, "reference/notes.md", "same\nmiddle\nsame")

    await run(setup, {
      command: "str_replace", reason: "replace first", file_path: "reference/notes.md",
      old_string: "same", new_string: "changed",
    })

    expect(await body(setup.repo, "reference/notes.md")).toBe("changed\nmiddle\nsame")
  })

  it("#given insert positions below and above the body #when insert runs #then positions clamp to first and lines+1", async () => {
    const setup = await fixture()
    await seed(setup, "system/list.md", "two\nthree")
    await run(setup, {
      command: "insert", reason: "prepend", file_path: "system/list", insert_line: -20, insert_text: "one",
    })
    await run(setup, {
      command: "insert", reason: "append", file_path: "system/list", insert_line: 999, insert_text: "four\nfive",
    })

    expect(await body(setup.repo, "system/list.md")).toBe("one\ntwo\nthree\nfour\nfive")
  })

  it("#given a nested directory #when delete runs #then it recursively removes every tracked file", async () => {
    const setup = await fixture()
    await seed(setup, "reference/history/one.md", "one")
    await seed(setup, "reference/history/two.md", "two")

    await run(setup, { command: "delete", reason: "delete history", file_path: "reference/history" })

    expect(await setup.repo.lsTree()).not.toContain("reference/history/one.md")
    expect(await setup.repo.lsTree()).not.toContain("reference/history/two.md")
  })

  it("#given an editable file #when rename runs #then it creates parents and tracks old and new paths", async () => {
    const setup = await fixture()
    await seed(setup, "system/old.md", "body")

    await run(setup, {
      command: "rename", reason: "move note", old_path: "system/old.md", new_path: "reference/deep/new.md",
    })

    expect(await setup.repo.lsTree()).toContain("reference/deep/new.md")
    expect(await setup.repo.lsTree()).not.toContain("system/old.md")
  })

})
