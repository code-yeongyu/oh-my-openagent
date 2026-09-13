import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { parseMemoryFile } from "./frontmatter"
import { MAX_DESCRIPTION_LENGTH, describeFrontmatterGrammarViolation, describeFrontmatterViolation } from "./frontmatter-validation"
import { installHooks } from "./hooks"
import { normalizeMemoryFrontmatter } from "./normalize"

const AUTHOR: GitCommitAuthor = { agentId: "agent-normalize", authorName: "Normalize Agent" }
const LEGACY_NOTE = "---\ndescription: Run the chain by default: verify, merge\n---\n\nnote body\n"
const LEGACY_SKILL = "---\nname: deploy\ndescription: senpi #1439 is the tail\nversion: 0.2.0\n---\n\n# Deploy\n"
const CLEAN = "---\ndescription: Already clean\n---\n\nclean body\n"
const roots: string[] = []

setDefaultTimeout(process.platform === "win32" ? 30_000 : 10_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(files: Record<string, string>) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-normalize-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: AUTHOR.agentId })
  await repo.init({
    seedFiles: Object.entries(files).map(([relativePath, content]) => ({ relativePath, content })),
  })
  return repo
}

async function strictFrontmatter(repo: GitMemoryRepo, path: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(repo.dir, path), "utf8")
  return parseYaml(content.slice(4, content.indexOf("\n---", 4))) as Record<string, unknown>
}

describe("normalizeMemoryFrontmatter", () => {
  it("#given legacy files beside a clean one #when normalized #then only the legacy files are rewritten in one commit and content is preserved", async () => {
    // #given
    const repo = await fixture({ "reference/note.md": LEGACY_NOTE, "skills/deploy/SKILL.md": LEGACY_SKILL, "system/clean.md": CLEAN })
    installHooks(repo.dir)
    const before = {
      note: parseMemoryFile(LEGACY_NOTE),
      skill: parseMemoryFile(LEGACY_SKILL),
    }
    const headBefore = await repo.head()

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("normalized")
    expect([...result.rewritten].sort()).toEqual(["reference/note.md", "skills/deploy/SKILL.md"])
    expect(result.skipped).toEqual([])
    expect(await repo.head()).not.toBe(headBefore)
    expect((await repo.log({ limit: 1 }))[0]?.subject).toContain("frontmatter")
    expect(await readFile(join(repo.dir, "system/clean.md"), "utf8")).toBe(CLEAN)
    for (const path of ["reference/note.md", "skills/deploy/SKILL.md"]) {
      expect(describeFrontmatterViolation(await readFile(join(repo.dir, path), "utf8"))).toBeNull()
    }
    expect(parseMemoryFile(await readFile(join(repo.dir, "reference/note.md"), "utf8"))).toEqual(before.note)
    expect(parseMemoryFile(await readFile(join(repo.dir, "skills/deploy/SKILL.md"), "utf8"))).toEqual(before.skill)
    expect(await strictFrontmatter(repo, "skills/deploy/SKILL.md")).toEqual({
      description: "senpi #1439 is the tail",
      name: "deploy",
      version: "0.2.0",
    })
    expect(await repo.status()).toBe("")
  })

  it("#given a normalized repository #when normalized again #then it is a no-op with no new commit", async () => {
    // #given
    const repo = await fixture({ "reference/note.md": LEGACY_NOTE })
    await normalizeMemoryFrontmatter(repo, AUTHOR)
    const head = await repo.head()

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("clean")
    expect(await repo.head()).toBe(head)
  })

  it("#given a legacy commit landing after a normalization #when normalized #then only the files changed since the last pass are examined", async () => {
    // #given
    const repo = await fixture({ "reference/a.md": LEGACY_NOTE, "reference/b.md": LEGACY_NOTE, "reference/c.md": LEGACY_NOTE })
    expect((await normalizeMemoryFrontmatter(repo, AUTHOR)).rewritten).toHaveLength(3)
    await writeFile(join(repo.dir, "reference/later.md"), LEGACY_NOTE.replace("note body", "later"))
    await repo.commitWrite(["reference/later.md"], "raw write from an older writer", AUTHOR)

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("normalized")
    expect(result.rewritten).toEqual(["reference/later.md"])
    expect(result.examined).toBe(1)
    expect(describeFrontmatterViolation(await readFile(join(repo.dir, "reference/later.md"), "utf8"))).toBeNull()
  })

  it("#given a dirty working tree #when normalized #then nothing is written and the result says why", async () => {
    // #given
    const repo = await fixture({ "reference/note.md": LEGACY_NOTE })
    await writeFile(join(repo.dir, "reference/scratch.md"), "uncommitted\n")
    const head = await repo.head()

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("skipped")
    expect(result.status === "skipped" ? result.detail : "").toContain("dirty")
    expect(await repo.head()).toBe(head)
    expect(await readFile(join(repo.dir, "reference/note.md"), "utf8")).toBe(LEGACY_NOTE)
  })

  it("#given a legacy file whose over-limit description also breaks the grammar #when normalized #then the grammar is repaired and the content rule is left for a real repair", async () => {
    // #given
    const long = `---\ndescription: swallowed: ${"x".repeat(MAX_DESCRIPTION_LENGTH + 50)}\n---\n\n`
    const repo = await fixture({ "reference/swallowed.md": long })

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("normalized")
    expect(result.rewritten).toEqual(["reference/swallowed.md"])
    const after = await readFile(join(repo.dir, "reference/swallowed.md"), "utf8")
    expect(describeFrontmatterGrammarViolation(after)).toBeNull()
    expect(parseYaml(after.slice(4, after.indexOf("\n---", 4))).description).toBe(parseMemoryFile(long).frontmatter.description)
    expect(describeFrontmatterViolation(after)).toContain(`${MAX_DESCRIPTION_LENGTH}`)
  })

  it("#given a read_only legacy file #when normalized #then it is reported as skipped and left untouched", async () => {
    // #given
    const locked = "---\ndescription: Locked by default: yes\nread_only: true\n---\n\nbody\n"
    const repo = await fixture({ "system/locked.md": locked, "reference/note.md": LEGACY_NOTE })

    // #when
    const result = await normalizeMemoryFrontmatter(repo, AUTHOR)

    // #then
    expect(result.status).toBe("normalized")
    expect(result.rewritten).toEqual(["reference/note.md"])
    expect(result.skipped).toEqual([{ path: "system/locked.md", reason: "read_only" }])
    expect(await readFile(join(repo.dir, "system/locked.md"), "utf8")).toBe(locked)
  })
})
