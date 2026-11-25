/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs"
import { chmod, cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { copyDirectoryTree } from "./codex-cache-fs"

// copyDirectoryTree replaced `cp(source, target, { recursive: true, filter })` at the installer's
// plugin, marketplace snapshot, root runtime and bundled MCP copies (#14000). These cases pin that
// both produce the same tree, so the installed payload cannot drift from what cp produced.

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-copy-tree-"))
  roots.push(root)
  return root
}

async function createFixtureTree(root: string): Promise<string> {
  const source = join(root, "source")
  await mkdir(join(source, "nested", "deeper"), { recursive: true })
  await mkdir(join(source, "empty"))
  await mkdir(join(source, "private"))
  await chmod(join(source, "private"), 0o700)
  await mkdir(join(source, ".config"))
  await writeFile(join(source, "nested", "deeper", "leaf.txt"), "leaf\n")
  await writeFile(join(source, ".hidden"), "dotfile\n")
  await writeFile(join(source, ".config", "settings.json"), '{"a":1}\n')
  await writeFile(join(source, "run.sh"), "#!/bin/sh\necho run\n")
  await chmod(join(source, "run.sh"), 0o755)
  await writeFile(join(source, "readonly.txt"), "read only\n")
  await chmod(join(source, "readonly.txt"), 0o444)
  await writeFile(join(source, "private", "secret.txt"), "secret\n")
  await symlink("nested/deeper/leaf.txt", join(source, "link-to-file"))
  await symlink("nested", join(source, "link-to-dir"))
  await symlink("missing-target", join(source, "dangling"))
  return source
}

type TreeEntry = { path: string; type: string; mode: number; link?: string; sha?: string }

function snapshotTree(root: string, directory = root): TreeEntry[] {
  const entries: TreeEntry[] = []
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name)
    const stats = lstatSync(path)
    const entry: TreeEntry = {
      path: relative(root, path).split(sep).join("/"),
      type: stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "dir" : stats.isFile() ? "file" : "other",
      mode: stats.mode & 0o7777,
    }
    if (stats.isSymbolicLink()) entry.link = readlinkSync(path)
    if (stats.isFile()) entry.sha = createHash("sha256").update(readFileSync(path)).digest("hex")
    entries.push(entry)
    if (stats.isDirectory()) entries.push(...snapshotTree(root, path))
  }
  return entries
}

async function outcome(run: () => Promise<void> | void): Promise<"ok" | "rejected"> {
  try {
    await run()
    return "ok"
  } catch {
    return "rejected"
  }
}

describe("copyDirectoryTree", () => {
  test("#given a tree with every entry kind #when copied into a fresh target #then it matches cp entry for entry", async () => {
    // given
    const root = await tempRoot()
    const source = await createFixtureTree(root)

    // when
    await cp(source, join(root, "by-cp", "out"), { recursive: true })
    copyDirectoryTree(source, join(root, "by-walk", "out"))

    // then
    const expected = snapshotTree(join(root, "by-cp", "out"))
    expect(expected.map((entry) => entry.type).sort()).toEqual(
      [
        "dir",
        "dir",
        "dir",
        "dir",
        "dir",
        "file",
        "file",
        "file",
        "file",
        "file",
        "file",
        "symlink",
        "symlink",
        "symlink",
      ].sort(),
    )
    expect(snapshotTree(join(root, "by-walk", "out"))).toEqual(expected)
  })

  test("#given an include filter #when copied #then it skips the same paths cp's filter skips", async () => {
    // given
    const root = await tempRoot()
    const source = await createFixtureTree(root)
    const include = (path: string) => !path.slice(source.length).split(sep).includes("nested")

    // when
    await cp(source, join(root, "by-cp"), { recursive: true, filter: include })
    copyDirectoryTree(source, join(root, "by-walk"), include)

    // then
    const expected = snapshotTree(join(root, "by-cp"))
    expect(expected.some((entry) => entry.path.startsWith("nested"))).toBe(false)
    expect(snapshotTree(join(root, "by-walk"))).toEqual(expected)
  })

  test("#given a target that already holds files, a link and a directory #when copied #then it merges exactly like cp", async () => {
    // given
    const root = await tempRoot()
    const source = await createFixtureTree(root)
    for (const target of [join(root, "by-cp"), join(root, "by-walk")]) {
      await mkdir(join(target, "nested"), { recursive: true })
      await chmod(join(target, "nested"), 0o750)
      await writeFile(join(target, ".hidden"), "stale\n")
      await writeFile(join(target, "extra.txt"), "kept\n")
      await symlink("elsewhere", join(target, "link-to-file"))
    }

    // when
    await cp(source, join(root, "by-cp"), { recursive: true })
    copyDirectoryTree(source, join(root, "by-walk"))

    // then
    const expected = snapshotTree(join(root, "by-cp"))
    expect(expected.find((entry) => entry.path === "extra.txt")).toBeDefined()
    expect(snapshotTree(join(root, "by-walk"))).toEqual(expected)
  })

  test("#given a target path that is a file #when copied #then it is refused like cp refuses it", async () => {
    // given
    const root = await tempRoot()
    const source = await createFixtureTree(root)
    await writeFile(join(root, "by-cp"), "a file\n")
    await writeFile(join(root, "by-walk"), "a file\n")

    // when
    const byCp = await outcome(() => cp(source, join(root, "by-cp"), { recursive: true }))
    const byWalk = await outcome(() => copyDirectoryTree(source, join(root, "by-walk")))

    // then
    expect(byCp).toBe("rejected")
    expect(byWalk).toBe(byCp)
    expect(readFileSync(join(root, "by-walk"), "utf8")).toBe("a file\n")
  })
})
