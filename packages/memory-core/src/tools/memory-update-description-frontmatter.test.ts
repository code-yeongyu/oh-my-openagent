import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { parseMemoryFile } from "../memfs/frontmatter"
import { describeFrontmatterViolation } from "../memfs/frontmatter-validation"
import { runMemoryApplyPatch } from "./memory-apply-patch"
import { runMemoryTool, type MemoryToolLock, type MemoryToolParams } from "./memory"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR: GitCommitAuthor = {
  agentId: "agent-update-description-frontmatter",
  authorName: "Frontmatter Repair Agent",
  authorEmail: "frontmatter@example.com",
}
const NOTE_PATH = "reference/notes.md"
const NOTE_BODY = "# Title\n\nSome body text.\n"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

setDefaultTimeout(process.platform === "win32" ? 30000 : 10000)

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-update-description-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const lock: MemoryToolLock = async (_domain, operation) => operation()
  return { repo, lock }
}

async function seedFrontmatterless(setup: Awaited<ReturnType<typeof fixture>>) {
  await seedBody(setup, NOTE_BODY)
}

async function seedBody(setup: Awaited<ReturnType<typeof fixture>>, body: string) {
  const fullPath = join(setup.repo.dir, NOTE_PATH)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, body, "utf8")
  await setup.repo.commitWrite([NOTE_PATH], `seed ${NOTE_PATH}`, AUTHOR)
}

async function run(setup: Awaited<ReturnType<typeof fixture>>, params: Omit<MemoryToolParams, "author">) {
  return runMemoryTool({ repo: setup.repo, lock: setup.lock, params: { ...params, author: AUTHOR } })
}

describe("memory tool update_description on a frontmatter-less note", () => {
  it("#given a committed note with no frontmatter #when update_description runs #then it adds a description-only frontmatter block and keeps the body byte-for-byte", async () => {
    // #given
    const setup = await fixture()
    await seedFrontmatterless(setup)

    // #when
    const result = await run(setup, {
      command: "update_description",
      reason: "add the missing description",
      file_path: NOTE_PATH,
      description: "Notes about references",
    })

    // #then
    const written = await readFile(join(setup.repo.dir, NOTE_PATH), "utf8")
    expect(describeFrontmatterViolation(written)).toBeNull()
    const parsed = parseMemoryFile(written)
    expect(parsed.frontmatter).toEqual({ description: "Notes about references" })
    expect(parsed.body).toBe(NOTE_BODY)
    expect(result.commit?.affectedPaths).toEqual([NOTE_PATH])
  })

  it("#given a committed note with no frontmatter #when str_replace runs #then it refuses and names update_description as the way to add frontmatter", async () => {
    // #given
    const setup = await fixture()
    await seedFrontmatterless(setup)
    const head = await setup.repo.head()

    // #when
    const attempt = run(setup, {
      command: "str_replace",
      reason: "edit the body",
      file_path: NOTE_PATH,
      old_string: "Some body text.",
      new_string: "Other text.",
    })

    // #then
    await expect(attempt).rejects.toThrow(/missing required frontmatter; add frontmatter with update_description/)
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given a committed note with no frontmatter #when the memory tool apply_patch updates it #then it refuses and names update_description", async () => {
    // #given
    const setup = await fixture()
    await seedFrontmatterless(setup)
    const head = await setup.repo.head()
    const input = [
      "*** Begin Patch",
      `*** Update File: ${NOTE_PATH}`,
      "@@",
      "-# Title",
      "+# Retitled",
      "*** End Patch",
    ].join("\n")

    // #when
    const attempt = run(setup, { command: "apply_patch", reason: "retitle", input })

    // #then
    await expect(attempt).rejects.toThrow(/missing required frontmatter; add frontmatter with update_description/)
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given a committed note with no frontmatter #when runMemoryApplyPatch updates it #then it refuses and names update_description", async () => {
    // #given
    const setup = await fixture()
    await seedFrontmatterless(setup)
    const head = await setup.repo.head()
    const input = [
      "*** Begin Patch",
      `*** Update File: ${NOTE_PATH}`,
      "@@",
      "-# Title",
      "+# Retitled",
      "*** End Patch",
    ].join("\n")

    // #when
    const attempt = runMemoryApplyPatch({ repo: setup.repo, lock: setup.lock, params: { reason: "retitle", input, author: AUTHOR } })

    // #then
    await expect(attempt).rejects.toThrow(/missing required frontmatter; add frontmatter with update_description/)
    expect(await setup.repo.head()).toBe(head)
  })

  it("#given a frontmatter-less note with a CRLF body #when update_description runs #then it adds the header and keeps the body byte-for-byte", async () => {
    // #given
    const setup = await fixture()
    const crlfBody = "# Title\r\n\r\nSome body text.\r\n"
    await seedBody(setup, crlfBody)

    // #when
    const result = await run(setup, {
      command: "update_description",
      reason: "add the missing description",
      file_path: NOTE_PATH,
      description: "Notes about references",
    })

    // #then
    const written = await readFile(join(setup.repo.dir, NOTE_PATH), "utf8")
    expect(written).toBe(`---\ndescription: Notes about references\n---\n${crlfBody}`)
    expect(describeFrontmatterViolation(written)).toBeNull()
    expect(parseMemoryFile(written).frontmatter.description).toBe("Notes about references")
    expect(result.commit?.affectedPaths).toEqual([NOTE_PATH])
  })

  it("#given a frontmatter-less note whose body opens with an unclosed --- line #when update_description runs #then it adds the header and keeps the body byte-for-byte", async () => {
    // #given
    const setup = await fixture()
    const unclosedBody = "---\nA rule with no closing line.\n"
    await seedBody(setup, unclosedBody)

    // #when
    const result = await run(setup, {
      command: "update_description",
      reason: "add the missing description",
      file_path: NOTE_PATH,
      description: "Notes about references",
    })

    // #then
    const written = await readFile(join(setup.repo.dir, NOTE_PATH), "utf8")
    expect(written).toBe(`---\ndescription: Notes about references\n---\n${unclosedBody}`)
    expect(parseMemoryFile(written).body).toBe(unclosedBody)
    expect(result.commit?.affectedPaths).toEqual([NOTE_PATH])
  })

  it("#given a note with a blank line before a real header #when update_description runs #then it refuses instead of burying the header", async () => {
    // #given
    const setup = await fixture()
    const buried = "\n---\ndescription: old\n---\nBody text.\n"
    await seedBody(setup, buried)
    const head = await setup.repo.head()

    // #when
    const attempt = run(setup, {
      command: "update_description",
      reason: "fix the description",
      file_path: NOTE_PATH,
      description: "Notes about references",
    })

    // #then
    await expect(attempt).rejects.toThrow(/blank lines before a --- line/)
    await expect(attempt).rejects.toThrow(/Remove the leading blank lines/)
    expect(await setup.repo.head()).toBe(head)
    expect(await readFile(join(setup.repo.dir, NOTE_PATH), "utf8")).toBe(buried)
  })

  it("#given a note whose body starts with a --- rule, then text, then --- #when update_description runs #then it refuses with a suggestion", async () => {
    // #given
    const setup = await fixture()
    const ruleBody = "---\nSome body text.\n---\nRest of the note.\n"
    await seedBody(setup, ruleBody)
    const head = await setup.repo.head()

    // #when
    const attempt = run(setup, {
      command: "update_description",
      reason: "add the missing description",
      file_path: NOTE_PATH,
      description: "Notes about references",
    })

    // #then
    await expect(attempt).rejects.toThrow(/frontmatter is missing 'description'/)
    await expect(attempt).rejects.toThrow(/suggestion: if this note has no frontmatter/)
    expect(await setup.repo.head()).toBe(head)
    expect(await readFile(join(setup.repo.dir, NOTE_PATH), "utf8")).toBe(ruleBody)
  })
})
