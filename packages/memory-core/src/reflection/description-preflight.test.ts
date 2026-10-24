import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs/frontmatter"
import { describeFrontmatterViolation, MAX_DESCRIPTION_LENGTH } from "../memfs/frontmatter-validation"
import { installHooks, resolveHooksDir } from "../memfs/hooks"
import { validateCompletion } from "./completion-validation"
import { preflightReflectionDescriptions } from "./description-preflight"
import { createReflectionWorktree, finalizeReflectionWorktree } from "./worktree"

const roots: string[] = []
const path = "reference/note.md"
const body = "\n# Durable note\r\n\r\nBody stays byte-identical.  \r\n"
const oversized = `${"summary ".repeat(139)}ending`
const author = { agentId: "agent-one", authorName: "Reflection Agent", authorEmail: "reflection@omo.local" }

async function fixture(content: string, existing = true, baseContent = renderMemoryFile({ description: "a".repeat(937) }, body)) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "description-preflight-")))
  roots.push(root)
  const parent = new GitMemoryRepo({ dir: join(root, "memory"), agentId: author.agentId })
  await parent.init({
    seedFiles: [
      { relativePath: "reference/base.md", content: renderMemoryFile({ description: "Base" }, "base\n") },
      ...(existing ? [{ relativePath: path, content: baseContent }] : []),
    ],
  })
  const worktree = await createReflectionWorktree(parent, "description", join(root, "worktrees"))
  const child = new GitMemoryRepo({ dir: worktree.dir, agentId: author.agentId })
  await writeFile(join(worktree.dir, path), content)
  await child.commitWrite([path], "reflection expanded summary", author)
  const tip = await child.head()
  if (tip === null) throw new Error("fixture has no reflection tip")
  return { parent, worktree, child, tip }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe("reflection description preflight", () => {
  it("#given a noncanonical header with a legacy limit #when trimmed #then every non-description byte stays in order", async () => {
    const before = `---\r\nkind: note\r\nlimit: 5000\r\nprovenance: "legacy receipt"\r\ndescription: ${oversized}\r\nname: 'x'\r\n---\r\n${body}`
    const { worktree } = await fixture(before)

    await preflightReflectionDescriptions(worktree, worktree.baseSha)

    expect(await readFile(join(worktree.dir, path), "utf8"))
      .toBe(before.replace(`description: ${oversized}`, `description: ${"summary ".repeat(127)}summary…`))
  })

  it("#given a body-only edit to a legacy oversized header #when preflight runs #then the accepted header and tip stay unchanged", async () => {
    const baseContent = renderMemoryFile({ description: oversized }, body)
    const content = `${baseContent}new body line\n`
    const { worktree, child, tip } = await fixture(content, true, baseContent)
    expect(await validateCompletion(worktree, worktree.baseSha)).toMatchObject({ status: "valid" })

    expect(await preflightReflectionDescriptions(worktree, worktree.baseSha)).toEqual([])

    expect(await child.head()).toBe(tip)
    expect(await readFile(join(worktree.dir, path), "utf8")).toBe(content)
    expect(await validateCompletion(worktree, worktree.baseSha)).toMatchObject({ status: "valid" })
  })

  for (const [existing, leading] of [[true, false], [false, false], [true, true]] as const) {
    it(`#given an ${existing ? "existing" : "added"} note with ${leading ? "leading spaces and " : ""}an oversized summary #when preflight runs #then one hooked commit preserves its body and validates`, async () => {
      const original = leading ? `   ${oversized}` : oversized
      const input = `---\ndescription: ${JSON.stringify(original)}\n---\n${body}`
      const { parent, worktree, child, tip } = await fixture(input, existing)
      expect(oversized.length).toBe(1118)
      // validateCompletion would repair the branch by dropping the note (#10528), so the pre-check reads the file.
      expect(describeFrontmatterViolation(input)).toBe(`'description' exceeds 1024 characters (${original.length})`)
      installHooks(worktree.dir, {
        checker: { execPath: process.execPath, script: join(import.meta.dir, "../memfs/memory-hook-cli.ts") },
      })

      const trimmed = await preflightReflectionDescriptions(worktree, worktree.baseSha)

      const content = await readFile(join(worktree.dir, path), "utf8")
      const parsed = parseMemoryFile(content)
      expect(trimmed[0]?.newLength).toBe(parsed.frontmatter.description.length)
      expect(parsed.frontmatter.description).toBe(leading
        ? `   ${"summary ".repeat(126)}summary…`
        : `${"summary ".repeat(127)}summary…`)
      expect(parsed.frontmatter.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH)
      expect(parsed.body).toBe(body)
      expect(describeFrontmatterViolation(content)).toBeNull()
      expect(trimmed).toEqual([{ path, originalLength: original.length, newLength: parsed.frontmatter.description.length }])
      const commits = await child.log({ limit: 2 })
      expect(commits[0]).toMatchObject({
        authorName: author.authorName,
        authorEmail: author.authorEmail,
      })
      expect(commits[0]?.body).toContain(`Omo-Description-Trimmed: ${path} (${original.length} -> ${parsed.frontmatter.description.length})`)
      expect(commits[1]?.sha).toBe(tip)
      expect(await parent.head()).toBe(worktree.baseSha)
      expect(await validateCompletion(worktree, worktree.baseSha)).toMatchObject({ status: "valid" })
      expect(await preflightReflectionDescriptions(worktree, worktree.baseSha)).toEqual([])
      expect(await child.head()).toBe(commits[0]?.sha)
    })
  }

  it("#given an oversized summary and duplicate key #when preflight runs #then the invalid note and tip remain untouched", async () => {
    const content = `---\ndescription: ${oversized}\nkind: note\nkind: duplicate\n---\n${body}`
    const { worktree, child, tip } = await fixture(content)

    expect(await preflightReflectionDescriptions(worktree, worktree.baseSha)).toEqual([])

    expect(await child.head()).toBe(tip)
    expect(await readFile(join(worktree.dir, path), "utf8")).toBe(content)
    // The gate keeps the run's other entries and drops this one (#10528); here it was the only entry.
    expect(await validateCompletion(worktree, worktree.baseSha)).toMatchObject({
      status: "no_changes",
      dropped: [{ path, reason: "invalid frontmatter: duplicate frontmatter key 'kind'" }],
    })
  })

  it("#given no oversized summary #when preflight runs #then it makes no commit", async () => {
    const content = renderMemoryFile({ description: "Short summary" }, body)
    const { worktree, child, tip } = await fixture(content)

    expect(await preflightReflectionDescriptions(worktree, worktree.baseSha)).toEqual([])

    expect(await child.head()).toBe(tip)
    expect(await readFile(join(worktree.dir, path), "utf8")).toBe(content)
  })

  it("#given an oversized word with no spaces #when preflight runs #then it hard-cuts within the limit", async () => {
    const { worktree } = await fixture(renderMemoryFile({ description: "x".repeat(1118) }, body))

    await preflightReflectionDescriptions(worktree, worktree.baseSha)

    expect(parseMemoryFile(await readFile(join(worktree.dir, path), "utf8")).frontmatter.description)
      .toBe(`${"x".repeat(1023)}…`)
  })

  it("#given an emoji across the hard-cut boundary #when preflight runs #then the description contains only complete code points", async () => {
    const { worktree } = await fixture(renderMemoryFile({ description: `${"x".repeat(1022)}😀${"x".repeat(94)}` }, body))

    await preflightReflectionDescriptions(worktree, worktree.baseSha)

    const description = parseMemoryFile(await readFile(join(worktree.dir, path), "utf8")).frontmatter.description
    expect(description).toBe(`${"x".repeat(1022)}…`)
    expect(description.isWellFormed()).toBe(true)
  })

  it("#given a refusing commit hook #when preflight runs #then it restores only its edits and the gate drops the note", async () => {
    const input = renderMemoryFile({ description: oversized }, body)
    const { worktree, child, tip } = await fixture(input)
    installHooks(worktree.dir)
    await writeFile(join(resolveHooksDir(worktree.dir), "pre-commit"), "#!/bin/sh\nexit 1\n")

    expect(await preflightReflectionDescriptions(worktree, worktree.baseSha)).toEqual([])

    expect(await child.head()).toBe(tip)
    expect(await child.status()).toBe("")
    expect(await readFile(join(worktree.dir, path), "utf8")).toBe(input)
    expect(await validateCompletion(worktree, worktree.baseSha)).toMatchObject({
      status: "no_changes",
      dropped: [{ path, reason: "invalid frontmatter: 'description' exceeds 1024 characters (1118)" }],
    })
  })

  it("#given an existing note expanded to 1118 characters #when finalized #then preflight repairs it before the completion gate", async () => {
    const { parent, worktree } = await fixture(renderMemoryFile({ description: oversized }, body))
    installHooks(worktree.dir)

    const result = await finalizeReflectionWorktree(worktree, {
      mode: "auto",
      summary: "shorten reflection description",
      withWriterLock: async (operation) => operation(),
    })

    expect(result).toMatchObject({ status: "merged", cleanup: { worktreeRemoved: true, branchRemoved: true } })
    const parsed = parseMemoryFile(await readFile(join(parent.dir, path), "utf8"))
    expect(parsed.frontmatter.description).toBe(`${"summary ".repeat(127)}summary…`)
    expect(parsed.body).toBe(body)
  })
})
