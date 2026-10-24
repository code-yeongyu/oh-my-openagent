import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { describeDroppedEntries, validateCompletion } from "./completion-validation"
import { createReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

const roots: string[] = []
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk\n-----END RSA PRIVATE KEY-----\n"
const GOOD = "---\ndescription: A good note\n---\n\nbody\n"
const exec = createNodeGitExec()

setDefaultTimeout(process.platform === "win32" ? 30_000 : 20_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(seedFiles: Record<string, string> = {}) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-partial-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: "agent-one" })
  await repo.init({ seedFiles: Object.entries(seedFiles).map(([relativePath, content]) => ({ relativePath, content })) })
  const worktree = await createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
  return { worktree }
}

async function git(dir: string, ...argv: string[]): Promise<string> {
  const result = await exec.run(argv, { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function commit(dir: string, files: Record<string, string>, message: string): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await git(dir, "add", "-A")
  await git(dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message)
}

async function removeAndCommit(dir: string, path: string, message: string): Promise<void> {
  await git(dir, "--literal-pathspecs", "rm", "-q", "--", path)
  await git(dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message)
}

const treePaths = async (dir: string): Promise<string[]> =>
  (await git(dir, "ls-tree", "-r", "--name-only", "HEAD")).split("\n").filter(Boolean)

describe("reflection completion keeps valid notes when one entry fails validation", () => {
  it("#given a good note and a note with a PEM block #when validated #then the good note is kept and the secret file dropped", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, { "reference/good.md": GOOD, "reference/leak.md": `---\ndescription: Leak\n---\n\n${PEM}` }, "two notes")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/good.md"])
    expect(result.dropped?.map((entry) => entry.path)).toEqual(["reference/leak.md"])
    expect(JSON.stringify(result.dropped)).not.toContain("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk")
    expect(await treePaths(worktree.dir)).not.toContain("reference/leak.md")
    expect(await git(worktree.dir, "status", "--porcelain")).toBe("")
  })

  it("#given a secret only in an earlier commit #when validated #then the branch history carries no secret blob", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, { "reference/good.md": GOOD, "reference/tmp.md": `---\ndescription: T\n---\n\n${PEM}` }, "add")
    await git(worktree.dir, "rm", "-q", "reference/tmp.md")
    await git(worktree.dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", "remove")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/good.md"])
    expect(await git(worktree.dir, "rev-list", "--count", `${worktree.baseSha}..HEAD`)).toBe("1")
  })

  it("#given a note whose description is over 1024 characters #when validated #then it is dropped and the others are kept", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, {
      "reference/good.md": GOOD,
      "reference/long.md": `---\ndescription: ${"x".repeat(1100)}\n---\n\nbody\n`,
    }, "notes")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/good.md"])
    expect(result.dropped?.[0]?.path).toBe("reference/long.md")
    expect(result.dropped?.[0]?.reason).toContain("exceeds 1024 characters")
  })

  it("#given a frontmatter-less root file moved into reference/ #when validated #then the move is undone and the other note is kept", async () => {
    const { worktree } = await fixture({ "notes-dump.md": "# Title\n\nno frontmatter\n" })
    await mkdir(join(worktree.dir, "reference"), { recursive: true })
    await git(worktree.dir, "mv", "notes-dump.md", "reference/notes-dump.md")
    await commit(worktree.dir, { "reference/good.md": GOOD }, "move and add")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/good.md"])
    const paths = await treePaths(worktree.dir)
    expect(paths).toContain("notes-dump.md")
    expect(paths).not.toContain("reference/notes-dump.md")
  })

  it("#given a repaired tip #when validated again #then the dropped entries are still reported and the commit message carries no secret", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, {
      "reference/good.md": GOOD,
      "reference/leak.md": `---\ndescription: Leak\n---\n\n${PEM}`,
      "reference/token=abc123456.md": "---\ndescription: Named\n---\n\nclean\n",
    }, "notes with password=hunter2Abrx9 in the subject")

    const first = await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    const second = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(first.status).toBe("valid")
    expect(second.status).toBe("valid")
    if (first.status !== "valid" || second.status !== "valid") return
    expect(second.tipSha).toBe(first.tipSha)
    expect(second.dropped?.length).toBe(2)
    expect(second.dropped?.map((entry) => entry.path).sort()).toEqual(["reference/***", "reference/leak.md"])
    const message = await git(worktree.dir, "log", "-1", "--format=%B")
    expect(message).toContain('Omo-Completion-Dropped: {"path":"reference/leak.md","reason":"secret_like_content')
    expect(message).not.toContain("hunter2Abrx9")
    expect(message).not.toContain("abc123456")
    expect(message).not.toContain("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk")
  })

  // Each name is also a git pathspec that matches OTHER notes (or, with a leading ':!', every other path).
  // Windows cannot create '*', '?', '|' or ':' in a file name, so those run on POSIX only; '[' is portable.
  const isWindows = process.platform === "win32"
  const globNames = isWindows
    ? ["reference/k[e]ep1.md"]
    : ["reference/k*.md", "reference/k?ep1.md", "reference/k[e]ep1.md", ":!reference.md"]
  for (const name of globNames) {
    it(`#given a dropped note named ${JSON.stringify(name)} #when validated #then only that note is dropped and no other note is touched`, async () => {
      const { worktree } = await fixture({ "reference/keep1.md": GOOD, "reference/keep2.md": GOOD })
      await commit(worktree.dir, { [name]: `---\ndescription: Leak\n---\n\n${PEM}`, "reference/good.md": GOOD }, "glob name")

      const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

      expect(result.status).toBe("valid")
      if (result.status !== "valid") return
      expect(result.changedPaths).toEqual(["reference/good.md"])
      expect(result.dropped?.map((entry) => entry.path)).toEqual([name])
      expect(await treePaths(worktree.dir)).toEqual(["reference/good.md", "reference/keep1.md", "reference/keep2.md"])
      expect(await git(worktree.dir, "status", "--porcelain")).toBe("")
    })
  }

  it("#given an existing glob-named note that gets a secret #when validated #then another note's valid edit is kept", async () => {
    const globbed = isWindows ? "reference/k[e]e[p]x.md" : "reference/k?ep*.md"
    const { worktree } = await fixture({ [globbed]: GOOD, "reference/keep1.md": GOOD })
    const edited = GOOD.replace("body", "edited body")
    await commit(worktree.dir, { [globbed]: `---\ndescription: Leak\n---\n\n${PEM}`, "reference/keep1.md": edited }, "edit both")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/keep1.md"])
    expect(await git(worktree.dir, "show", "HEAD:reference/keep1.md")).toBe(edited.trimEnd())
  })

  it("#given a valid glob-named note #when the agent deletes it #then the deletion is kept, not undone", async () => {
    const { worktree } = await fixture({ "reference/k[e]p.md": GOOD, "reference/keep1.md": GOOD })
    await removeAndCommit(worktree.dir, "reference/k[e]p.md", "delete it")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/k[e]p.md"])
    expect(result.dropped ?? []).toEqual([])
    expect(await treePaths(worktree.dir)).toEqual(["reference/keep1.md"])
  })

  it("#given a new glob-named note with no frontmatter #when validated #then it is dropped like any other", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, { "reference/k[x].md": "no frontmatter here\n", "reference/good.md": GOOD }, "bare glob note")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["reference/good.md"])
    expect(result.dropped?.map((entry) => entry.path)).toEqual(["reference/k[x].md"])
  })

  it("#given the user's git sets glob or icase pathspecs #when a note is dropped #then the drop still succeeds", async () => {
    const saved = { glob: process.env.GIT_GLOB_PATHSPECS, icase: process.env.GIT_ICASE_PATHSPECS }
    process.env.GIT_ICASE_PATHSPECS = "1"
    try {
      const { worktree } = await fixture()
      await commit(worktree.dir, { "reference/leak.md": `---\ndescription: Leak\n---\n\n${PEM}`, "reference/good.md": GOOD }, "icase env")

      const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

      expect(result.status).toBe("valid")
      if (result.status !== "valid") return
      expect(result.changedPaths).toEqual(["reference/good.md"])
    } finally {
      if (saved.icase === undefined) delete process.env.GIT_ICASE_PATHSPECS
      else process.env.GIT_ICASE_PATHSPECS = saved.icase
    }
  })

  it("#given a secret-shaped file name #when the drop is described #then the note never prints the raw name", async () => {
    const { worktree } = await fixture()
    const name = "reference/ghp_Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5.md"
    await commit(worktree.dir, { [name]: "---\ndescription: Named\n---\n\nclean\n", "reference/good.md": GOOD }, "secret name")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    const note = describeDroppedEntries(result.dropped ?? [])
    expect(note).toContain("Dropped 1 invalid memory entry")
    expect(note).not.toContain("Ab3dEf5hJ7kL9mN1pQ3rS5tU7vW9xY1zB3C5")
  })

  it.skipIf(isWindows)("#given a dropped path containing ' | ' #when validated again #then the trailer reads back the same path", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, { "reference/a | b.md": `---\ndescription: Leak\n---\n\n${PEM}`, "reference/good.md": GOOD }, "pipe name")

    await validateCompletion(worktree, worktree.baseSha, worktree.exec)
    const again = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(again.status).toBe("valid")
    if (again.status !== "valid") return
    expect(again.dropped?.map((entry) => entry.path)).toEqual(["reference/a | b.md"])
  })

  it("#given every changed note is invalid #when validated #then nothing is committed and the run reports no changes", async () => {
    const { worktree } = await fixture()
    await commit(worktree.dir, { "reference/leak.md": `---\ndescription: Leak\n---\n\n${PEM}` }, "leak")

    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    expect(result.status).toBe("no_changes")
    if (result.status !== "no_changes") return
    expect(result.tipSha).toBe(worktree.baseSha)
    expect(result.dropped?.map((entry) => entry.path)).toEqual(["reference/leak.md"])
  })
})
