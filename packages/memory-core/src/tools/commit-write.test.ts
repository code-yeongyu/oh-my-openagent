import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { DirtyRepoError, GitCommandError, GitMemoryRepo, MemorySecretError } from "../git"
import { renderMemoryFile } from "../memfs/frontmatter"
import { installHooks } from "../memfs/hooks"
import { commitMemoryWrite } from "./commit-write"
import { applyMemoryPatch } from "./patch-apply"

const AUTHOR = { agentId: "commit-agent", authorName: "Commit Agent", authorEmail: "commit@example.test" }
const tempDirs: string[] = []

async function hookedRepo() {
  const root = await mkdtemp(join(tmpdir(), "memory-commit-write-"))
  tempDirs.push(root)
  const dir = join(root, "memory")
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  installHooks(dir)
  return { dir, repo }
}

function writeMemory(repo: GitMemoryRepo, dir: string, path: string, content: string) {
  return commitMemoryWrite({
    repo,
    lock: async (_domain, operation) => operation(),
    apply: async () => {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
      return { affectedPaths: [path] }
    },
    reason: `remember ${path}`,
    author: AUTHOR,
    successLabel: "Memory",
  })
}

async function rejected(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`Expected Error rejection, received ${String(error)}`)
  }
  throw new Error("Expected operation to reject")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

setDefaultTimeout(process.platform === "win32" ? 30_000 : 15_000)

const caseInsensitiveFs = (() => {
  const probe = mkdtempSync(join(tmpdir(), "memory-commit-case-"))
  try {
    writeFileSync(join(probe, "Aa"), "")
    return existsSync(join(probe, "aA"))
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

describe("commitMemoryWrite", () => {
  it.each(["reference/cli.md", "reference/[x].md", ...(process.platform === "win32" ? [] : [":*.md", ":!*.md"])])("#given a hook-refused write to %s #when it commits #then it rolls back and the next write commits", async (path) => {
    // given
    const { dir, repo } = await hookedRepo()
    const secretNote = renderMemoryFile({ description: "CLI notes" }, '\napiKey: "!op read example"\n')
    const plainNote = renderMemoryFile({ description: "Plain notes" }, "\nnothing secret here\n")
    await writeMemory(repo, dir, "reference/x.md", plainNote)
    const head = await repo.head()

    // when
    const error = await rejected(writeMemory(repo, dir, path, secretNote))

    // then
    expect(error).toBeInstanceOf(GitCommandError)
    expect(error).not.toBeInstanceOf(MemorySecretError)
    expect(error.message).toContain("secret-like content (credential_assignment)")
    expect(await repo.head()).toBe(head)
    expect(await repo.status()).toBe("")
    expect(await repo.show("HEAD", "reference/x.md")).toBe(plainNote)
    const next = await writeMemory(repo, dir, "reference/plain.md", plainNote)
    expect(next.affectedPaths).toEqual(["reference/plain.md"])
  })

  it.skipIf(!caseInsensitiveFs)("#given a tracked file and a write through a path that differs only in case #when the commit refuses it as an unrelated change #then the tracked file stays in place", async () => {
    // given
    const { dir, repo } = await hookedRepo()
    await writeMemory(repo, dir, "reference/Notes.md", renderMemoryFile({ description: "Notes" }, "\noriginal\n"))

    // when
    const error = await rejected(writeMemory(repo, dir, "reference/notes.md", renderMemoryFile({ description: "Notes" }, "\nchanged\n")))

    // then
    expect(error).toBeInstanceOf(DirtyRepoError)
    expect(await readdir(join(dir, "reference"))).toEqual(["Notes.md"])
    expect((await repo.status()).trim()).toBe("M reference/Notes.md")
  })

  it.each(["canonical first", "alias first", "case-only move"])("#given two case spellings (%s) #when a patch is refused #then tracked data and the next write survive", async (order) => {
    // given
    const { dir, repo } = await hookedRepo()
    await repo.configSet("core.autocrlf", "true")
    const canonical = "reference/Notes.md"
    const alias = "reference/notes.md"
    const refusedPath = "reference/refused.md"
    const original = renderMemoryFile({ description: "Notes" }, "\noriginal\n")
    const secret = renderMemoryFile({ description: "Notes" }, '\napiKey: "!op read example"\n')
    await writeMemory(repo, dir, canonical, original)
    const head = await repo.head()
    const update = (path: string) => [`*** Update File: ${path}`, "@@", "-original", '+apiKey: "!op read example"'].join("\n")
    const add = (path: string) => [`*** Add File: ${path}`, ...secret.trimEnd().split("\n").map(line => `+${line}`)].join("\n")
    const operations = order === "case-only move"
      ? [[`*** Update File: ${canonical}`, `*** Move to: ${alias}`, "@@", "-original", '+apiKey: "!op read example"'].join("\n"), add(refusedPath)]
      : [update(canonical), caseInsensitiveFs ? update(alias) : add(alias)]
    if (order === "alias first") operations.reverse()

    // when
    const error = await rejected(commitMemoryWrite({
      repo, lock: async (_domain, operation) => operation(),
      apply: () => applyMemoryPatch(dir, ["*** Begin Patch", ...operations, "*** End Patch"].join("\n")),
      reason: "refuse case aliases", author: AUTHOR, successLabel: "Memory",
    }))

    // then
    const command = error instanceof GitCommandError ? error.argv.find(arg => arg === "add" || arg === "commit") : undefined
    expect(command === "add" || command === "commit").toBe(true)
    expect(error.name).toBe("GitCommandError")
    expect(await repo.head()).toBe(head)
    expect(await readdir(join(dir, "reference"))).toEqual(["Notes.md"])
    expect(await readFile(join(dir, canonical))).toEqual(Buffer.from(original))
    expect(existsSync(join(dir, alias))).toBe(caseInsensitiveFs)
    expect(existsSync(join(dir, refusedPath))).toBe(false)
    expect(await repo.status()).toBe("")
    const next = await writeMemory(repo, dir, "reference/recovered.md", original)
    expect(next.affectedPaths).toEqual(["reference/recovered.md"])
    expect(next.sha).not.toBe(head)
    expect(await repo.status()).toBe("")
  })
})
