import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { applyIdentityMerge, planIdentityMerge } from "./merge"
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

afterEach(removeMergeRoots)

describe("identity merge (#10070)", () => {
  // Skipped on Windows because the fixture cannot be built there: Windows git refuses a backslash index path
  // (git update-index --cacheinfo ...\\..\\outside.md fails), a setup limit, not a gap in the guard. The same
  // escape is still covered on Windows by the table row "notes\\..\\..\\outside.md" in
  // "#given a source tree entry named %j ... both refuse it" below, whose tree is built with git mktree.
  it.skipIf(process.platform === "win32")(
    "#given a source path whose backslashes decode to a climb out of the repository #when the merge applies #then it is refused and nothing is written outside",
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

      const outcome = await applyIdentityMerge({
        source: source.paths,
        target: target.paths,
        lock,
        author: AUTHOR,
      }).catch((error: unknown) => error)

      expect(outcome).toBeInstanceOf(Error)
      expect(String(outcome)).toContain("outside the memory repository")
      expect(await target.repo.head()).toBe(before)
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
  ])(
    "#given a source tree entry named %j #when the merge is planned and applied #then both refuse it and nothing in or beside the target repository changes (#12974 security)",
    async (path, content) => {
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
      const before = await fingerprint(target.paths.root, GIT_READ_STATE)

      const planned = await planIdentityMerge(source.paths, target.paths).then(
        () => "planned",
        (error: unknown) => String(error),
      )
      const applied = await applyIdentityMerge({
        source: source.paths,
        target: target.paths,
        lock,
        author: AUTHOR,
      }).then(
        (result) => result.status,
        (error: unknown) => String(error),
      )

      expect(changedEntries(before, await fingerprint(target.paths.root, GIT_READ_STATE))).toEqual([])
      expect(planned).toContain(path)
      expect(applied).toContain(path)
    },
    30_000,
  )
})
