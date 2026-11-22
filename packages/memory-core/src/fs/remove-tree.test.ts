import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "./remove-tree"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(join(root, "tree", "locked"), 0o700).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

describe("removeTree (H2)", () => {
  test("#given read-only files inside a read-only directory #when the tree is removed #then nothing is left", async () => {
    const root = await mkdtemp(join(tmpdir(), "remove-tree-"))
    roots.push(root)
    const tree = join(root, "tree")
    await mkdir(join(tree, "locked"), { recursive: true })
    for (const name of ["reflection-persona.md", "reflection-task.md", "transcript-payload.json"]) {
      await writeFile(join(tree, name), "payload\n")
      await chmod(join(tree, name), 0o400)
    }
    await writeFile(join(tree, "locked", "inner.json"), "{}\n")
    await chmod(join(tree, "locked", "inner.json"), 0o400)
    await chmod(join(tree, "locked"), 0o500)

    await removeTree(tree)

    expect(existsSync(tree)).toBe(false)
  })

  test("#given a path that does not exist #when it is removed #then that is success", async () => {
    const root = await mkdtemp(join(tmpdir(), "remove-tree-"))
    roots.push(root)
    await removeTree(join(root, "absent"))
    expect(existsSync(join(root, "absent"))).toBe(false)
  })
})
