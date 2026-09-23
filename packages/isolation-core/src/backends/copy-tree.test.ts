import { expect, test } from "bun:test"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { copyTree } from "./copy-tree"

test("copyTree does not descend into its own destination when it lives inside the source", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "self-copy-"))
  const lower = join(root, "repo")
  await mkdir(join(lower, "nested"), { recursive: true })
  await writeFile(join(lower, "nested", "file"), "content")
  // The volume walk places the base directory inside the repository when the
  // repository root is a subvolume with its own st_dev; ensure creates the
  // parent before the backend starts, so the destination already exists.
  const destination = join(lower, ".omo-wt", "handle", "m")
  await mkdir(join(lower, ".omo-wt", "handle"), { recursive: true })
  try {
    await copyTree(lower, destination, async (_src, dst, size) => {
      if (size > 0) await writeFile(dst, "cloned")
    }, () => {})
    expect(await readFile(join(destination, "nested", "file"), "utf8")).toBe("cloned")
    // The walk must not chase its own output: the destination subtree the
    // source already contains stays un-copied below the new tree.
    await expect(access(join(destination, ".omo-wt", "handle", "m"))).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
