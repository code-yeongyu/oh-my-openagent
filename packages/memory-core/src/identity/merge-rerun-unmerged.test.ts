import { afterEach, describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

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
  removeMergeRoots,
} from "./merge.test-support"
import { readIdentityRecord } from "./record"

afterEach(removeMergeRoots)

describe("identity merge rerun of a store left unmerged (#10070)", () => {
  it("#given a store merged once with an entry left out #when the merge reruns #then nothing is written again, no second aside copy appears and the entry is still named", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { "notes/base.md": note("base"), "notes/diff.md": note("target") },
      ["/work/project"],
    )
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "notes/a.md": note("a"), "notes/diff.md": note("source") },
      ["/work/project-feature"],
    )
    commitTreePath(source.paths.repo, "skills/.git/config", "[core]\n\tbare = false\n")
    const first = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
    const before = await fingerprint(target.paths.root, GIT_READ_STATE)
    const headBefore = await target.repo.head()

    const rerun = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(first.status).toBe("merged")
    expect(rerun.status).toBe("nothing-to-merge")
    expect(rerun.plan.actions).toStrictEqual([
      { path: "notes/a.md", action: "skip" },
      { path: "notes/diff.md", action: "skip" },
      { path: "skills/.git/config", action: "unplaceable", reason: "not-a-plain-path" },
    ])
    expect(changedEntries(before, await fingerprint(target.paths.root, GIT_READ_STATE))).toStrictEqual([])
    expect(await target.repo.head()).toBe(headBefore)
    expect(await readdir(join(target.paths.repo, "reference/merged"))).toStrictEqual(["project-feature-bbbb2222"])
    expect((await readIdentityRecord(source.paths.root))?.mergedInto).toBeUndefined()
  }, 30_000)
})
