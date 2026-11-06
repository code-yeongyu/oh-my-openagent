import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { auditMemoryRepo } from "../audit/audit"
import { GitMemoryRepo, createNodeGitExec } from "../git"
import { validateCompletion } from "./completion-validation"
import { createReflectionWorktree } from "./worktree"
import { removeTree } from "../../../../test-support/remove-tree"

const roots: string[] = []
const exec = createNodeGitExec()
const note = (description: string, body: string): string => `---\ndescription: ${description}\n---\n\n${body}`

setDefaultTimeout(process.platform === "win32" ? 30_000 : 20_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture(seedFiles: Record<string, string>) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-links-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: "agent-one" })
  await repo.init({ seedFiles: Object.entries(seedFiles).map(([relativePath, content]) => ({ relativePath, content })) })
  return createReflectionWorktree(repo, "run-1", join(root, "worktrees"))
}

async function git(dir: string, ...argv: string[]): Promise<string> {
  const result = await exec.run(argv, { cwd: dir, timeoutMs: 30_000 })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, "add", "-A")
  await git(dir, "-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-qm", message)
}

async function put(dir: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content)
}

const read = (dir: string, path: string): Promise<string> => readFile(join(dir, path), "utf8")

describe("reflection completion repoints links to the notes a run removed (#12642)", () => {
  it("#given a dream that archives a fact ledger other notes link to #when validated #then no link dangles and each points at the archive", async () => {
    // given
    const worktree = await fixture({
      "ARCHIVE.md": "# Archive\n",
      "notes/facts/2026-10.md": note("Explicit facts for 2026-10", "- [2026-10-01] The build uses Bun.\n"),
      "notes/facts/2026-10-topic.md": note("Build topic", "See [[notes/facts/2026-10.md]] and [the ledger](2026-10.md#top).\n"),
    })
    await git(worktree.dir, "rm", "-q", "notes/facts/2026-10.md")
    await put(worktree.dir, "ARCHIVE.md", "# Archive\n\n- 2026-10: the build uses Bun.\n")
    await commitAll(worktree.dir, "chore(dream): archive oversized October fact ledger")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toContain("notes/facts/2026-10-topic.md")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
    const topic = await read(worktree.dir, "notes/facts/2026-10-topic.md")
    expect(topic).toContain("[[ARCHIVE.md|notes/facts/2026-10.md (archived)]]")
    expect(topic).toContain("[the ledger](../../ARCHIVE.md)")
    expect(await git(worktree.dir, "status", "--porcelain")).toBe("")
  })

  it("#given a dream that moves a note #when validated #then wiki and markdown links follow it, keeping their anchors and aliases", async () => {
    // given
    const worktree = await fixture({
      "reference/old.md": note("Old home", "content\n"),
      "notes/user.md": note("User", "[[reference/old|the note]], [[reference/old.md#part]], [x](../reference/old.md#sec).\n"),
    })
    await mkdir(join(worktree.dir, "reference/new"), { recursive: true })
    await git(worktree.dir, "mv", "reference/old.md", "reference/new/home.md")
    await commitAll(worktree.dir, "chore(dream): move old note")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect((await auditMemoryRepo(worktree.dir)).counts.link_dangling).toBe(0)
    expect(await read(worktree.dir, "notes/user.md")).toContain(
      "[[reference/new/home|the note]], [[reference/new/home.md#part]], [x](../reference/new/home.md#sec).",
    )
  })

  it("#given a dream that deletes a note without archiving it #when validated #then links become plain text and quoted examples stay as written", async () => {
    // given
    const worktree = await fixture({
      "reference/junk.md": note("Junk", "junk\n"),
      "notes/user.md": note("User", "Gone: [[reference/junk.md|junk]] and [j](../reference/junk.md).\n\n```\n[[reference/junk.md]]\n```\n"),
    })
    await git(worktree.dir, "rm", "-q", "reference/junk.md")
    await commitAll(worktree.dir, "chore(dream): delete junk")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    expect(await read(worktree.dir, "notes/user.md")).toContain("Gone: junk and j.\n\n```\n[[reference/junk.md]]\n```\n")
  })

  it("#given a link that already dangled before the run #when validated #then the run leaves it to the audit", async () => {
    // given
    const worktree = await fixture({
      "notes/user.md": note("User", "[[reference/never-existed.md]]\n"),
      "notes/other.md": note("Other", "x\n"),
    })
    await put(worktree.dir, "notes/other.md", note("Other", "y\n"))
    await commitAll(worktree.dir, "chore(dream): edit")

    // when
    const result = await validateCompletion(worktree, worktree.baseSha, worktree.exec)

    // then
    expect(result.status).toBe("valid")
    if (result.status !== "valid") return
    expect(result.changedPaths).toEqual(["notes/other.md"])
    expect(await read(worktree.dir, "notes/user.md")).toContain("[[reference/never-existed.md]]")
  })
})
