import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { applyIdentityMerge } from "./merge"
import {
  AUTHOR,
  changedEntries,
  commitTreePath,
  fingerprint,
  GIT_READ_STATE,
  identity,
  lock,
  memoryRoot,
  note,
  plumb,
  removeMergeRoots,
} from "./merge.test-support"
import { readIdentityRecord } from "./record"

afterEach(removeMergeRoots)

const HOOK_PATH = "deep/../.git/hooks/pre-commit"

/** Merges three good files, plus `bad` when given, into a target with a planted hook; reports what changed. */
async function mergeWith(bad: string | undefined) {
  const root = await memoryRoot()
  const target = await identity(
    root,
    "project-aaaa1111",
    { "notes/base.md": note("base"), "notes/diff.md": note("target") },
    ["/work/project"],
  )
  const hook = join(target.paths.repo, ".git/hooks/pre-commit")
  await mkdir(dirname(hook), { recursive: true })
  await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const source = await identity(
    root,
    "project-feature-bbbb2222",
    { "notes/a.md": note("a"), "notes/b.md": note("b"), "notes/diff.md": note("source") },
    ["/work/project-feature"],
  )
  if (bad !== undefined) commitTreePath(source.paths.repo, bad, "#!/bin/sh\ntouch ../hook-ran\n")
  const before = await fingerprint(target.paths.root, GIT_READ_STATE)
  const headBefore = (await target.repo.head()) ?? ""
  const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
  const changed = changedEntries(before, await fingerprint(target.paths.root, GIT_READ_STATE))
  return { target, source, result, changed, headBefore }
}

describe("identity merge around a source entry that is not a plain path (#10070)", () => {
  it("#given a store with three good files and one entry that climbs into .git #when it is merged #then the good files land in one commit, the bad entry writes nothing and is named, and the store is not marked merged", async () => {
    const merged = await mergeWith(HOOK_PATH)
    const control = await mergeWith(undefined)

    expect(merged.result.status).toBe("merged")
    expect(merged.result.plan.actions).toStrictEqual([
      { path: HOOK_PATH, action: "unplaceable", reason: "not-a-plain-path" },
      { path: "notes/a.md", action: "add", destination: "notes/a.md" },
      { path: "notes/b.md", action: "add", destination: "notes/b.md" },
      {
        path: "notes/diff.md",
        action: "keep-aside",
        destination: "reference/merged/project-feature-bbbb2222/notes/diff.md",
      },
    ])
    expect(merged.changed).toStrictEqual(control.changed)
    expect(merged.changed.filter((name) => !name.startsWith("repo/.git/"))).toStrictEqual([
      "repo/notes/a.md",
      "repo/notes/b.md",
      "repo/reference/",
      "repo/reference/merged/",
      "repo/reference/merged/project-feature-bbbb2222/",
      "repo/reference/merged/project-feature-bbbb2222/notes/",
      "repo/reference/merged/project-feature-bbbb2222/notes/diff.md",
    ])
    const repo = merged.target.paths.repo
    expect(plumb(repo, ["rev-list", "--count", `${merged.headBefore}..HEAD`]).trim()).toBe("1")
    expect(plumb(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).trim().split("\n")).toStrictEqual([
      "notes/a.md",
      "notes/b.md",
      "reference/merged/project-feature-bbbb2222/notes/diff.md",
    ])
    expect((await readIdentityRecord(merged.source.paths.root))?.mergedInto).toBeUndefined()
  }, 60_000)

  it("#given a store whose every entry is not a plain path #when it is merged #then nothing is committed, the target is unchanged, every entry is named and the store is not marked merged", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", {}, ["/work/project-feature"])
    commitTreePath(source.paths.repo, "skills/.git/config", "[core]\n\tbare = false\n")
    commitTreePath(source.paths.repo, "notes\\..\\..\\outside.md", note("carried"))
    const before = await fingerprint(target.paths.root, GIT_READ_STATE)
    const headBefore = await target.repo.head()

    const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(result.status).toBe("nothing-to-merge")
    expect(result.plan.actions).toStrictEqual([
      { path: "notes\\..\\..\\outside.md", action: "unplaceable", reason: "not-a-plain-path" },
      { path: "skills/.git/config", action: "unplaceable", reason: "not-a-plain-path" },
    ])
    expect(changedEntries(before, await fingerprint(target.paths.root, GIT_READ_STATE))).toStrictEqual([])
    expect(await target.repo.head()).toBe(headBefore)
    expect((await readIdentityRecord(source.paths.root))?.mergedInto).toBeUndefined()
  }, 30_000)
})
