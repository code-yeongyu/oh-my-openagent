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
  it("#given read_only frontmatter #when update_description runs #then it rejects without changing HEAD", async () => {
    const setup = await fixture()
    await seed(setup, "system/locked.md", "body", "true")
    const head = await setup.repo.head()

    await expect(run(setup, {
      command: "update_description", reason: "change locked", file_path: "system/locked", description: "New",
    })).rejects.toThrow("memory: system/locked is read_only and cannot be modified")
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given editable frontmatter with read_only false #when update_description runs #then body and flag are preserved", async () => {
    const setup = await fixture()
    await seed(setup, "system/note.md", "keep body", "false")

    await run(setup, {
      command: "update_description", reason: "describe note", file_path: "system/note", description: "New description",
    })

    expect(parseMemoryFile(await readFile(join(setup.repo.dir, "system/note.md"), "utf8"))).toEqual({
      frontmatter: { description: "New description", read_only: "false" }, body: "keep body",
    })
  })

  it("#given read_only descendants #when recursive delete runs #then tool-level enforcement rejects the directory", async () => {
    const setup = await fixture()
    await seed(setup, "reference/history/locked.md", "body", "true")

    await expect(run(setup, {
      command: "delete", reason: "delete locked directory", file_path: "reference/history",
    })).rejects.toThrow(/memory: .*locked\.md is read_only/)
  })

  it("#given each editable mutation command targets read_only content #when run #then every command rejects", async () => {
    const cases: Array<Omit<MemoryToolParams, "author">> = [
      { command: "str_replace", reason: "replace", file_path: "locked", old_string: "body", new_string: "new" },
      { command: "insert", reason: "insert", file_path: "locked", insert_line: 1, insert_text: "new" },
      { command: "delete", reason: "delete", file_path: "locked" },
      { command: "rename", reason: "rename", old_path: "locked", new_path: "moved" },
    ]

    const setup = await fixture()
    await seed(setup, "locked.md", "body", "true")
    for (const params of cases) {
      await expect(run(setup, params)).rejects.toThrow(/memory: locked is read_only/)
    }
  })

  it("#given invalid and missing command inputs #when run #then caller-neutral typed tool errors retain the memory prefix", async () => {
    const rows: Array<{ params: Omit<MemoryToolParams, "author">; message: RegExp }> = [
      { params: { command: "create", reason: " ", file_path: "x", description: "x" }, message: /^memory: 'reason' must be a non-empty string/ },
      { params: { command: "create", reason: "x", file_path: "x", description: " " }, message: /^memory: create: 'description'/ },
      { params: { command: "insert", reason: "x", file_path: "x", insert_line: Number.NaN, insert_text: "x" }, message: /^memory: insert: 'insert_line' must be a number/ },
      { params: { command: "insert", reason: "x", file_path: "x", insert_line: 1, insert_text: "" }, message: /^memory: insert: 'insert_text'/ },
      { params: { command: "rename", reason: "x", old_path: "", new_path: "x" }, message: /^memory: rename: 'old_path'/ },
    ]

    const setup = await fixture()
    for (const row of rows) {
      const error = await run(setup, row.params).then(() => null, (cause: unknown) => cause)
      expect(error).toBeInstanceOf(MemoryToolError)
      expect(error instanceof Error ? error.message : String(error)).toMatch(row.message)
    }
  })

  it("#given existing or missing targets #when commands require the opposite #then they fail without commits", async () => {
    const setup = await fixture()
    await seed(setup, "note.md", "body")
    const head = await setup.repo.head()

    await expect(run(setup, {
      command: "create", reason: "duplicate", file_path: "note", description: "Duplicate",
    })).rejects.toThrow("memory: create: block already exists")
    await expect(run(setup, {
      command: "str_replace", reason: "missing string", file_path: "note", old_string: "absent", new_string: "new",
    })).rejects.toThrow("memory: str_replace: old_string was not found")
    await expect(run(setup, {
      command: "rename", reason: "overwrite", old_path: "note", new_path: "note",
    })).rejects.toThrow("memory: rename: destination already exists")
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given byte-identical replacements or descriptions #when commit detects no diff #then it reports no effective changes", async () => {
    const rows: Array<Omit<MemoryToolParams, "author">> = [
      { command: "str_replace", reason: "no op", file_path: "note", old_string: "same", new_string: "same" },
      { command: "update_description", reason: "no op", file_path: "note", description: "Seed" },
    ]

    for (const params of rows) {
      const setup = await fixture()
      await seed(setup, "note.md", "same")
      const head = await setup.repo.head()
      await expect(run(setup, params)).rejects.toThrow(`memory: ${params.command} made no effective changes`)
      expect(await setup.repo.head()).toBe(head)
      expect(await setup.repo.status()).toBe("")
    }
  })

  it("#given an untracked empty directory #when delete yields no affected tracked paths #then it reports made no changes", async () => {
    const setup = await fixture()
    await mkdir(join(setup.repo.dir, "empty"))

    await expect(run(setup, {
      command: "delete", reason: "delete empty", file_path: "empty",
    })).rejects.toThrow("memory: delete made no changes")
  })

  it("#given a UTF-16 BOM memory file #when a mutating command reads it #then a typed error asks for UTF-8 conversion", async () => {
    const setup = await fixture()
    const path = join(setup.repo.dir, "utf16.md")
    await writeFile(path, Buffer.from("---\ndescription: UTF16\n---\nbody", "utf16le"))
    const bytes = await readFile(path)
    await writeFile(path, Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]))
    await setup.repo.commitWrite(["utf16.md"], "seed utf16", AUTHOR)

    await expect(run(setup, {
      command: "insert", reason: "edit utf16", file_path: "utf16", insert_line: 1, insert_text: "new",
    })).rejects.toThrow(/memory: .*UTF-16.*convert.*UTF-8/i)
  })

  it("#given unrelated dirty files #when a command starts #then cleanCheck fails first with porcelain listing", async () => {
    const setup = await fixture()
    await writeFile(join(setup.repo.dir, "dirty.md"), "dirty")

    await expect(run(setup, {
      command: "create", reason: "blocked", file_path: "new", description: "New",
    })).rejects.toThrow(/memory: Memory repo has uncommitted changes[\s\S]*\?\? dirty\.md/)
    expect(await readFile(join(setup.repo.dir, "dirty.md"), "utf8")).toBe("dirty")
  })
})
