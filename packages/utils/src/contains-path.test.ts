import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { containsPath, isWithinProject } from "./contains-path"

const tempRoots = new Set<string>()

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-contains-path-"))
  tempRoots.add(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true })
  }
  tempRoots.clear()
})

describe("containsPath", () => {
  test("#given identical paths #when checking containment #then root contains itself", () => {
    const root = createTempRoot()

    expect(containsPath(root, root)).toBe(true)
  })

  test("#given an existing child file #when checking containment #then root contains the child", () => {
    const root = createTempRoot()
    const childDir = join(root, "src")
    const childFile = join(childDir, "index.ts")
    mkdirSync(childDir)
    writeFileSync(childFile, "export {}\n")

    expect(containsPath(root, childFile)).toBe(true)
  })

  test("#given a missing descendant #when checking containment #then root still contains the future path", () => {
    const root = createTempRoot()
    const missingChild = join(root, "generated", "future.json")

    expect(containsPath(root, missingChild)).toBe(true)
  })

  test("#given a sibling with the same path prefix #when checking containment #then it is rejected", () => {
    const parent = createTempRoot()
    const root = join(parent, "project")
    const sibling = join(parent, "project-copy")
    mkdirSync(root)
    mkdirSync(sibling)

    expect(containsPath(root, join(sibling, "file.ts"))).toBe(false)
  })
})

describe("isWithinProject", () => {
  test("#given candidate under project root #when checking project containment #then returns true", () => {
    const projectRoot = createTempRoot()
    const candidate = join(projectRoot, "docs", "guide.md")

    expect(isWithinProject(candidate, projectRoot)).toBe(true)
  })
})
