import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isolationProblems, prepareBaseTree } from "./base-tree"

// Review 6061267823 H2: the merge-base tree must run its own workspace packages, never the head's. Guards the gate's
// base-versus-head comparison (design 7.4): a base that imports the head's source compares the head with itself.

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function trees(): { readonly head: string; readonly base: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sdk-parity-base-tree-")))
  roots.push(root)
  const head = join(root, "head")
  const base = join(root, "base")
  for (const tree of [head, base]) {
    mkdirSync(join(tree, "packages", "core"), { recursive: true })
    writeFileSync(join(tree, "packages", "core", "package.json"), '{"name":"@ws/core"}')
  }
  mkdirSync(join(head, "node_modules", "@ws"), { recursive: true })
  symlinkSync("../../packages/core", join(head, "node_modules", "@ws", "core"))
  mkdirSync(join(head, "node_modules", "left-pad"))
  return { head, base }
}

describe("merge-base dependency isolation (review H2)", () => {
  test("#given a package-level node_modules whose workspace link points at the head (review 6061624223 M4) #then it is named", () => {
    const { head, base } = trees()
    mkdirSync(join(base, "packages", "app", "node_modules", "@ws"), { recursive: true })
    symlinkSync(join(head, "packages", "core"), join(base, "packages", "app", "node_modules", "@ws", "core"))
    expect(isolationProblems(base)).toEqual([
      `workspace package @ws/core (packages/app/node_modules) resolves to ${join(head, "packages", "core")}, outside the tree ${base}; the comparison would run the other tree's source`,
    ])
  })

  test("#given the head's per-package dependencies #then the prepared base links each workspace package into itself", () => {
    const { head, base } = trees()
    mkdirSync(join(head, "packages", "app", "node_modules", "@ws"), { recursive: true })
    symlinkSync("../../../core", join(head, "packages", "app", "node_modules", "@ws", "core"))
    mkdirSync(join(base, "packages", "app"), { recursive: true })
    prepareBaseTree(head, base)
    expect(realpathSync(join(base, "packages", "app", "node_modules", "@ws", "core"))).toBe(
      join(base, "packages", "core"),
    )
    expect(isolationProblems(base)).toEqual([])
  })

  test("#given the head's installed dependencies #then the base links its workspace packages into itself and shares only the external ones", () => {
    const { head, base } = trees()
    prepareBaseTree(head, base)
    expect(realpathSync(join(base, "node_modules", "@ws", "core"))).toBe(join(base, "packages", "core"))
    expect(realpathSync(join(base, "node_modules", "left-pad"))).toBe(join(head, "node_modules", "left-pad"))
    expect(isolationProblems(base)).toEqual([])
  })

  test("#given a workspace package the head reaches through a copy in bun's store #then the base links it to its own package", () => {
    const { head, base } = trees()
    const store = join(head, "node_modules", ".bun", "core-copy", "node_modules", "@ws", "core")
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, "package.json"), '{"name":"@ws/core"}')
    mkdirSync(join(head, "packages", "app", "node_modules", "@ws"), { recursive: true })
    symlinkSync(store, join(head, "packages", "app", "node_modules", "@ws", "core"))
    mkdirSync(join(base, "packages", "app"), { recursive: true })
    prepareBaseTree(head, base)
    expect(realpathSync(join(base, "packages", "app", "node_modules", "@ws", "core"))).toBe(
      join(base, "packages", "core"),
    )
    expect(isolationProblems(base)).toEqual([])
  })

  test("#given a base whose node_modules is the head's (the old link) #then its workspace package is named as resolving outside it", () => {
    const { head, base } = trees()
    symlinkSync(join(head, "node_modules"), join(base, "node_modules"))
    expect(isolationProblems(base)).toEqual([
      `workspace package @ws/core (node_modules) resolves to ${join(head, "packages", "core")}, outside the tree ${base}; the comparison would run the other tree's source`,
    ])
  })
})
