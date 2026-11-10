import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { buildIdentityPaths } from "./layout"
import { applyIdentityMerge, findMergePredecessors, planIdentityMerge } from "./merge"
import { readIdentityRecord, recordIdentityBind } from "./record"

const AUTHOR: GitCommitAuthor = { agentId: "merge-test", authorName: "Merge Test", authorEmail: "merge@example.com" }
const lock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => operation()
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function memoryRoot(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-merge-")))
  roots.push(root)
  return root
}

async function identity(root: string, id: string, files: Record<string, string>, spellings: readonly string[]) {
  const paths = buildIdentityPaths(root, id)
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const written = Object.keys(files)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(paths.repo, path)), { recursive: true })
    await writeFile(join(paths.repo, path), content)
  }
  if (written.length > 0) await repo.commitWrite(written, `seed ${id}`, AUTHOR)
  for (const [index, spelling] of spellings.entries()) {
    await recordIdentityBind(paths.root, { id, kind: "auto", mode: "path", source: spelling, spelling }, 1000 + index)
  }
  return { id, paths, repo }
}

const note = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`

describe("identity merge (#10070)", () => {
  it("#given per-worktree identities whose recorded spellings now resolve to the repository identity #when predecessors are found #then they are listed and an unrelated identity is reported unmapped", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", {}, ["/work/project"])
    await identity(root, "project-feature-bbbb2222", { "notes/a.md": note("a") }, ["/work/project-feature"])
    await identity(root, "other-cccc3333", { "notes/b.md": note("b") }, ["/elsewhere/other"])
    const resolve = (spelling: string) => spelling.startsWith("/work/project") ? target.id : "other-cccc3333"

    const found = await findMergePredecessors(root, target.id, resolve)

    expect(found.predecessors.map((entry) => entry.id)).toEqual(["project-feature-bbbb2222"])
    expect(found.unmapped).toEqual(["other-cccc3333"])
  }, 30_000)

  it("#given a predecessor with new, identical, differing and system files #when the merge is planned #then nothing is written and each file gets its action", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/same.md": note("same"), "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", {
      "notes/new.md": note("new"),
      "notes/same.md": note("same"),
      "notes/diff.md": note("source"),
      "system/persona.md": note("persona"),
    }, ["/work/project-feature"])
    const headBefore = await target.repo.head()

    const plan = await planIdentityMerge(source.paths, target.paths)

    expect(plan.actions).toEqual([
      { path: "notes/diff.md", action: "keep-aside", destination: "reference/merged/project-feature-bbbb2222/notes/diff.md" },
      { path: "notes/new.md", action: "add", destination: "notes/new.md" },
      { path: "notes/same.md", action: "skip" },
      { path: "system/persona.md", action: "keep-aside", destination: "reference/merged/project-feature-bbbb2222/system/persona.md" },
    ])
    expect(await target.repo.head()).toBe(headBefore)
  }, 30_000)

  it("#given a planned merge #when it is applied twice #then one commit carries the merge trailers, the target system/ is untouched, the source is marked mergedInto and the second apply is a no-op", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "system/persona.md": note("target persona"), "notes/diff.md": note("target") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", {
      "notes/new.md": note("new"),
      "notes/diff.md": note("source"),
      "system/persona.md": note("source persona"),
    }, ["/work/project-feature"])
    const sourceHead = await source.repo.head()

    const first = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 5000 })
    const second = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR, now: 6000 })

    expect(first.status).toBe("merged")
    expect(second.status).toBe("already-merged")
    const commit = (await target.repo.log({ limit: 1 }))[0]
    expect(commit?.trailers["Omo-Merged-From"]).toBe("project-feature-bbbb2222")
    expect(commit?.trailers["Omo-Merged-Head"]).toBe(sourceHead ?? "")
    expect(await readFile(join(target.paths.repo, "system/persona.md"), "utf8")).toBe(note("target persona"))
    expect(await readFile(join(target.paths.repo, "notes/new.md"), "utf8")).toBe(note("new"))
    expect(await readFile(join(target.paths.repo, "reference/merged/project-feature-bbbb2222/notes/diff.md"), "utf8")).toBe(note("source"))
    expect(await readIdentityRecord(source.paths.root)).toMatchObject({ mergedInto: "project-aaaa1111", mergedHead: sourceHead })
    expect(await source.repo.head()).toBe(sourceHead)
  }, 30_000)
})
