import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, symlinkSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
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
  plumb,
  removeMergeRoots,
} from "./merge.test-support"

afterEach(removeMergeRoots)

describe("identity merge (#10070)", () => {
  it("#given the target notes directory is a symlink to outside the repository #when the merge applies #then the file is left out and named and the outside directory stays empty", async () => {
    const root = await memoryRoot()
    const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
    const source = await identity(root, "project-feature-bbbb2222", { "notes/new.md": note("new") }, [
      "/work/project-feature",
    ])
    const outside = join(root, "outside")
    await mkdir(outside)
    await rm(join(target.paths.repo, "notes"), { recursive: true })
    symlinkSync(outside, join(target.paths.repo, "notes"))
    execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "add", "notes"], {
      cwd: target.paths.repo,
      stdio: "ignore",
    })
    execFileSync(
      "git",
      ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "commit", "-q", "--no-verify", "-m", "link notes"],
      {
        cwd: target.paths.repo,
        stdio: "ignore",
      },
    )

    const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(result.plan.actions).toStrictEqual([
      { path: "notes/new.md", action: "unplaceable", reason: "through-a-link-or-file" },
    ])
    expect(existsSync(join(outside, "new.md"))).toBe(false)
  }, 30_000)

  it.each([
    [
      "a tracked directory link",
      { "notes/kept.md": note("from source") },
      "through-a-link-or-file",
      async (repo: string, outside: string) => {
        await rm(join(repo, "notes"), { recursive: true })
        symlinkSync(outside, join(repo, "notes"))
      },
    ],
    [
      "the aside root as a tracked link",
      { "notes/base.md": note("from source") },
      "through-a-link-or-file",
      async (repo: string, outside: string) => {
        symlinkSync(outside, join(repo, "reference"))
      },
    ],
    [
      "a git-ignored file link",
      { "local/kept.md": note("from source") },
      "already-on-disk",
      async (repo: string, outside: string) => {
        await mkdir(join(repo, "local"))
        symlinkSync(join(outside, "kept.md"), join(repo, "local/kept.md"))
      },
    ],
  ] as const)(
    "#given a destination that leaves the target repository through %s #when the merge applies #then the entry is left out and named and nothing outside the repository is written, created or removed (#12974 security)",
    async (_link, sourceFiles, reason, plant) => {
      const root = await memoryRoot()
      const outside = join(root, "outside")
      await mkdir(outside)
      await writeFile(join(outside, "kept.md"), "not memory\n")
      const target = await identity(
        root,
        "project-aaaa1111",
        { ".gitignore": "local/\n", "notes/base.md": note("base") },
        ["/work/project"],
      )
      await plant(target.paths.repo, outside)
      plumb(target.paths.repo, ["add", "-A"])
      plumb(target.paths.repo, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "links"])
      const source = await identity(root, "project-feature-bbbb2222", sourceFiles, ["/work/project-feature"])
      const outsideBefore = await fingerprint(outside)
      const targetBefore = await fingerprint(target.paths.root, GIT_READ_STATE)

      const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

      expect(changedEntries(outsideBefore, await fingerprint(outside))).toEqual([])
      expect(changedEntries(targetBefore, await fingerprint(target.paths.root, GIT_READ_STATE))).toEqual([])
      expect(result.status).toBe("nothing-to-merge")
      expect(result.plan.actions).toStrictEqual(
        Object.keys(sourceFiles).map((path) => ({ path, action: "unplaceable", reason })),
      )
    },
    30_000,
  )

  it("#given a merge that creates a new directory and then meets a path already on the target disk #when it applies #then that path is left out and named, the user's file keeps its bytes and only the new file is committed (#12974 security review)", async () => {
    const root = await memoryRoot()
    const target = await identity(
      root,
      "project-aaaa1111",
      { ".gitignore": "local/\n", "notes/base.md": note("base") },
      ["/work/project"],
    )
    await mkdir(join(target.paths.repo, "local"))
    await writeFile(join(target.paths.repo, "local/mine.md"), "kept out of memory on purpose\n")
    const source = await identity(
      root,
      "project-feature-bbbb2222",
      { "fresh/deep/new.md": note("new"), "local/mine.md": note("from source") },
      ["/work/project-feature"],
    )

    const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(result.plan.actions).toStrictEqual([
      { path: "fresh/deep/new.md", action: "add", destination: "fresh/deep/new.md" },
      { path: "local/mine.md", action: "unplaceable", reason: "already-on-disk" },
    ])
    expect(await fingerprint(join(target.paths.repo, "local"))).toStrictEqual({
      "mine.md": "kept out of memory on purpose\n",
    })
    expect(plumb(target.paths.repo, ["diff", "--name-only", "HEAD~1", "HEAD"]).trim()).toBe("fresh/deep/new.md")
    expect(await readFile(join(target.paths.repo, "local/mine.md"), "utf8")).toBe("kept out of memory on purpose\n")
    expect((await target.repo.status()).trim()).toBe("")
  }, 30_000)

  it.each([
    [
      "a git-ignored file",
      "local/mine.md",
      (repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "local/mine.md", note("from source"))
        return writeFile(join(repo, "local/mine.md"), "kept out of memory on purpose\n")
      },
    ],
    [
      "a git-ignored link to a tracked file",
      "local/mine.md",
      async (repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "local/mine.md", note("from source"))
        symlinkSync(join(repo, "system/persona.md"), join(repo, "local/mine.md"))
      },
    ],
    [
      // The same file only where the disk folds Unicode forms (default macOS); elsewhere a second file.
      "the other Unicode form of a tracked name",
      "people/cafe\u0301.md",
      async (_repo: string, sourceRepo: string) => {
        commitTreePath(sourceRepo, "people/cafe\u0301.md", note("from source"))
      },
    ],
  ] as const)(
    "#given a planned path that is already on the target disk as %s #when the merge applies #then what was there keeps its bytes, the target is left clean and an occupied path is named (#12974 security)",
    async (_existing, path, plant) => {
      const root = await memoryRoot()
      const target = await identity(
        root,
        "project-aaaa1111",
        {
          ".gitignore": "local/\n",
          "system/persona.md": note("target persona"),
          "people/caf\u00e9.md": note("target person"),
        },
        ["/work/project"],
      )
      await mkdir(join(target.paths.repo, "local"))
      const source = await identity(root, "project-feature-bbbb2222", {}, ["/work/project-feature"])
      await plant(target.paths.repo, source.paths.repo)
      const before = await fingerprint(target.paths.repo, [".git"])
      // Occupied wherever the disk resolves the planned name to what is there (always for local/mine.md).
      const occupied = existsSync(join(target.paths.repo, path))

      const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

      const after = await fingerprint(target.paths.repo, [".git"])
      expect(Object.keys(before).filter((name) => after[name] !== before[name])).toEqual([])
      expect((await target.repo.status()).trim()).toBe("")
      expect(result.plan.actions).toStrictEqual([
        occupied
          ? { path, action: "unplaceable", reason: "already-on-disk" }
          : { path, action: "add", destination: path },
      ])
    },
    30_000,
  )
})
