import { afterEach, describe, expect, it } from "bun:test"
import { symlinkSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { applyIdentityMerge, type MergeAction } from "./merge"
import {
  AUTHOR,
  changedEntries,
  fingerprint,
  identity,
  lock,
  memoryRoot,
  note,
  plumb,
  removeMergeRoots,
} from "./merge.test-support"
import { readIdentityRecord } from "./record"

afterEach(removeMergeRoots)

const GOOD = { "notes/a.md": note("a"), "notes/b.md": note("b"), "notes/diff.md": note("source") }
const GOOD_ACTIONS: readonly MergeAction[] = [
  { path: "notes/a.md", action: "add", destination: "notes/a.md" },
  { path: "notes/b.md", action: "add", destination: "notes/b.md" },
  {
    path: "notes/diff.md",
    action: "keep-aside",
    destination: "reference/merged/project-feature-bbbb2222/notes/diff.md",
  },
]
const GOOD_WRITES = ["notes/a.md", "notes/b.md", "reference/merged/project-feature-bbbb2222/notes/diff.md"]

/** A target with a git-ignored `local/` and a tracked link `linked` to a directory outside the repository. */
async function stores(sourceFiles: Record<string, string>) {
  const root = await memoryRoot()
  const outside = join(root, "outside")
  await mkdir(outside)
  await writeFile(join(outside, "kept.md"), "not memory\n")
  const target = await identity(
    root,
    "project-aaaa1111",
    { ".gitignore": "local/\n", "notes/base.md": note("base"), "notes/diff.md": note("target") },
    ["/work/project"],
  )
  await mkdir(join(target.paths.repo, "local"))
  await writeFile(join(target.paths.repo, "local/mine.md"), "kept out of memory on purpose\n")
  symlinkSync(outside, join(target.paths.repo, "linked"))
  plumb(target.paths.repo, ["add", "-A"])
  plumb(target.paths.repo, ["commit", "-q", "--no-verify", "-m", "link"])
  const source = await identity(root, "project-feature-bbbb2222", sourceFiles, ["/work/project-feature"])
  return { outside, target, source }
}

async function mergeAndObserve(sourceFiles: Record<string, string>) {
  const { outside, target, source } = await stores(sourceFiles)
  const outsideBefore = await fingerprint(outside)
  const repoBefore = await fingerprint(target.paths.repo, [".git"])
  const headBefore = (await target.repo.head()) ?? ""
  const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })
  return {
    result,
    outsideChanged: changedEntries(outsideBefore, await fingerprint(outside)),
    repoChanged: changedEntries(repoBefore, await fingerprint(target.paths.repo, [".git"])),
    committed: plumb(target.paths.repo, ["diff", "--name-only", headBefore, "HEAD"]).trim().split("\n"),
    clean: (await target.repo.status()).trim() === "",
    target,
    source,
  }
}

const MERGED_DIRS = [
  "reference/",
  "reference/merged/",
  "reference/merged/project-feature-bbbb2222/",
  "reference/merged/project-feature-bbbb2222/notes/",
]

describe("identity merge around a destination already taken on the target disk (#10070)", () => {
  it("#given a planned file that is already on the target disk as a git-ignored file #when the store is merged #then the user's file keeps its bytes, nothing is written for it and the other files merge in one commit", async () => {
    const merged = await mergeAndObserve({ ...GOOD, "local/mine.md": note("from source") })

    expect(merged.result.status).toBe("merged")
    expect(merged.result.plan.actions).toStrictEqual([
      { path: "local/mine.md", action: "unplaceable", reason: "already-on-disk" },
      ...GOOD_ACTIONS,
    ])
    expect(await readFile(join(merged.target.paths.repo, "local/mine.md"), "utf8")).toBe(
      "kept out of memory on purpose\n",
    )
    expect(merged.repoChanged).toStrictEqual([...GOOD_WRITES, ...MERGED_DIRS].sort())
    expect(merged.committed).toStrictEqual(GOOD_WRITES)
    expect(merged.clean).toBe(true)
    expect((await readIdentityRecord(merged.source.paths.root))?.pendingPaths).toStrictEqual(["local/mine.md"])
  }, 30_000)

  it("#given a planned file whose directory is a tracked link out of the repository #when the store is merged #then nothing is written outside or through the link and the other files merge in one commit", async () => {
    const merged = await mergeAndObserve({ ...GOOD, "linked/kept.md": note("from source") })

    expect(merged.result.status).toBe("merged")
    expect(merged.result.plan.actions).toStrictEqual([
      { path: "linked/kept.md", action: "unplaceable", reason: "through-a-link-or-file" },
      ...GOOD_ACTIONS,
    ])
    expect(merged.outsideChanged).toStrictEqual([])
    expect(merged.repoChanged).toStrictEqual([...GOOD_WRITES, ...MERGED_DIRS].sort())
    expect(merged.committed).toStrictEqual(GOOD_WRITES)
    expect(merged.clean).toBe(true)
    expect((await readIdentityRecord(merged.source.paths.root))?.pendingPaths).toStrictEqual(["linked/kept.md"])
  }, 30_000)
})
