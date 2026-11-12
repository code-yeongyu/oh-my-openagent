import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { applyIdentityMerge, planIdentityMerge, type MergeAction } from "./merge"
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

const unplaceable = (actions: readonly MergeAction[]) => actions.filter((action) => action.action === "unplaceable")

/** The same store without the entry commitTreePath added: its parent tree less that top-level name. */
function dropTreeEntry(repoDir: string, path: string): void {
  const top = path.split("/")[0]
  const kept = plumb(repoDir, ["ls-tree", "-z", "HEAD~1"])
    .split("\0")
    .filter((line) => line !== "" && !line.endsWith(`\t${top}`))
  const tree = plumb(repoDir, ["mktree", "-z"], [...kept, ""].join("\0")).trim()
  plumb(repoDir, ["update-ref", "HEAD", plumb(repoDir, ["commit-tree", tree, "-p", "HEAD", "-m", "without it"]).trim()])
}

describe("identity merge (#10070)", () => {
  // Skipped on Windows because the fixture cannot be built there: Windows git refuses a backslash index path
  // (git update-index --cacheinfo ...\\..\\outside.md fails), a setup limit, not a gap in the guard. The same
  // escape is still covered on Windows by the table row "notes\\..\\..\\outside.md" in
  // "#given a source tree entry named %j ... both refuse it" below, whose tree is built with git mktree.
  it.skipIf(process.platform === "win32")(
    "#given a source path whose backslashes decode to a climb out of the repository #when the merge applies #then the entry is left out and named, only the plain file is committed and nothing is written outside",
    async () => {
      const root = await memoryRoot()
      const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
      const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
        "/work/project-feature",
      ])
      const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: source.paths.repo,
        input: note("escaped"),
      })
        .toString()
        .trim()
      execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},notes\\..\\..\\outside.md`], {
        cwd: source.paths.repo,
        stdio: "ignore",
      })
      execFileSync(
        "git",
        ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "escape"],
        { cwd: source.paths.repo, stdio: "ignore" },
      )
      const before = await target.repo.head()
      const escaped = join(target.paths.repo, "..", "outside.md")

      const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

      expect(unplaceable(result.plan.actions)).toStrictEqual([
        { path: "notes\\..\\..\\outside.md", action: "unplaceable", reason: "not-a-plain-path" },
      ])
      expect(plumb(target.paths.repo, ["diff", "--name-only", before ?? "", "HEAD"]).trim()).toBe("notes/ok.md")
      expect(existsSync(escaped)).toBe(false)
    },
    30_000,
  )

  // Security contract (#12974): a source tree is data. An entry name that is not plain `/`-separated names
  // must never reach the disk: `..` leaves the repository (or lands in its `.git`), a backslash is a
  // separator on Windows and in `restorePaths`, and git's own directory has more spellings than `.git`.
  it.each([
    ["deep/../../outside.md", note("carried")],
    ["deep/../system/persona.md", note("carried")],
    ["deep/.. /system/persona.md", note("carried")],
    ["deep/../.git/hooks/pre-commit", "#!/bin/sh\ntouch ../hook-ran\n"],
    ["deep/../.git/refs/heads/planted", note("carried")],
    ["notes/./base.md", note("carried")],
    ["notes\\..\\..\\outside.md", note("carried")],
    ["notes\\..\\system\\persona.md", note("carried")],
    ["system\\persona.md", note("carried")],
    ["skills/.git/config", "[core]\n\tbare = false\n"],
    ["skills/.GIT/config", "[core]\n\tbare = false\n"],
    ["skills/git~1/config", "[core]\n\tbare = false\n"],
    ["skills/.git./config", "[core]\n\tbare = false\n"],
    ["skills/.git /config", "[core]\n\tbare = false\n"],
    ["skills/.git::$INDEX_ALLOCATION/config", "[core]\n\tbare = false\n"],
    ["skills/.g\u200cit/config", "[core]\n\tbare = false\n"],
    // Plain names to isPlainTreePath (`C:` folds to `c`); only the confinement check refuses this drive-absolute path.
    ["C:/x.md", note("carried")],
    // Under the aside root but not plain: classified before the aside-copy skip, so each stays pending.
    ["reference/merged/x/../../y.md", note("carried")],
    ["reference/merged/x/.git/config", "[core]\n\tbare = false\n"],
  ])(
    "#given a source tree entry named %j #when the merge is planned and applied #then both name it unplaceable and nothing in or beside the target changes beyond what the store without it merges (#12974 security)",
    async (path, content) => {
      const merged = await mergeTreeEntry(path, content, true)
      const control = await mergeTreeEntry(path, content, false)

      expect(merged.changed).toStrictEqual(control.changed)
      expect(merged.written).toStrictEqual(control.written)
      expect(merged.status).toBe(control.status)
      expect(unplaceable(merged.planned)).toStrictEqual([{ path, action: "unplaceable", reason: "not-a-plain-path" }])
      expect(unplaceable(merged.applied)).toStrictEqual([{ path, action: "unplaceable", reason: "not-a-plain-path" }])
      expect(merged.pending).toStrictEqual([path])
    },
    60_000,
  )
})

/** Merges a store holding `path` (or, as the control, the same store without it) into a target with a planted hook. */
async function mergeTreeEntry(path: string, content: string, withEntry: boolean) {
  const root = await memoryRoot()
  const target = await identity(
    root,
    "project-aaaa1111",
    { "notes/base.md": note("base"), "system/persona.md": note("target persona") },
    ["/work/project"],
  )
  const hook = join(target.paths.repo, ".git/hooks/pre-commit")
  await mkdir(dirname(hook), { recursive: true })
  await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const source = await identity(root, "project-feature-bbbb2222", { "notes/ok.md": note("ok") }, [
    "/work/project-feature",
  ])
  commitTreePath(source.paths.repo, path, content)
  if (!withEntry) dropTreeEntry(source.paths.repo, path)
  const before = await fingerprint(target.paths.root, GIT_READ_STATE)

  const planned = (await planIdentityMerge(source.paths, target.paths)).actions
  const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

  const after = await fingerprint(target.paths.root, GIT_READ_STATE)
  const changed = changedEntries(before, after)
  const written = Object.fromEntries(
    changed.filter((name) => !name.startsWith("repo/.git/")).map((name) => [name, after[name]]),
  )
  const pending = (await readIdentityRecord(source.paths.root))?.pendingPaths
  return { planned, applied: result.plan.actions, status: result.status, changed, written, pending }
}
