import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, win32 } from "node:path"

import { isInside, isInstalled, isolationProblems, prepareBaseTree } from "./base-tree"

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

// Issue #15052: Windows real paths use backslashes and another drive's path is absolute after relative(); these run the
// Windows path rules on any host, so a separator assumption fails here before it reaches the hosted Windows leg.
describe("real paths per path dialect (#15052)", () => {
  test("#given backslash real paths #then an installed package is recognised by its node_modules directory", () => {
    expect(isInstalled("C:\\work\\head\\node_modules\\left-pad", win32)).toBe(true)
    expect(isInstalled("C:\\work\\head\\node_modules\\.bun\\core-copy\\node_modules\\@ws\\core", win32)).toBe(true)
    expect(isInstalled("C:/work/head/node_modules/left-pad", win32)).toBe(true)
    expect(isInstalled("C:\\work\\head\\packages\\core", win32)).toBe(false)
  })

  // Review 6067780823 LOW: on POSIX a backslash is a file-name character, so only "/" separates directories there.
  test("#given POSIX real paths with a backslash inside a name #then only a whole node_modules directory counts", () => {
    expect(isInstalled("/work/head/node_modules/left-pad", posix)).toBe(true)
    expect(isInstalled("/work/head/packages/node_modules-notes", posix)).toBe(false)
    expect(isInstalled("/work/head/packages/a\\node_modules\\b", posix)).toBe(false)
    expect(isInstalled("/work/head/node_modules\\x/core", posix)).toBe(false)
    expect(isInside("/work/head/a\\..\\b", "/work/head", posix)).toBe(true)
  })

  test("#given Windows paths #then inside, a sibling, a parent and another drive are told apart", () => {
    expect(isInside("C:\\work\\head\\packages\\core", "C:\\work\\head", win32)).toBe(true)
    expect(isInside("C:\\work\\head", "C:\\work\\head", win32)).toBe(true)
    expect(isInside("C:\\work\\head\\..notes", "C:\\work\\head", win32)).toBe(true)
    expect(isInside("C:\\work\\base\\packages\\core", "C:\\work\\head", win32)).toBe(false)
    expect(isInside("C:\\work", "C:\\work\\head", win32)).toBe(false)
    expect(isInside("D:\\cache\\left-pad", "C:\\work\\head", win32)).toBe(false)
  })
})

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
