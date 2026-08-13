import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nearestNodeBin } from "../bin/lib/package-paths.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("nearestNodeBin", () => {
  test("returns the ancestor bin for a scoped package", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-package-paths-"))
    roots.push(root)

    const modules = join(root, "node_modules")
    const packageRoot = join(modules, "@code-yeongyu", "senpi")
    const ancestorBin = join(modules, ".bin")
    mkdirSync(join(packageRoot, "node_modules", ".bin"), { recursive: true })
    mkdirSync(ancestorBin, { recursive: true })

    expect(nearestNodeBin(packageRoot)).toBe(ancestorBin)
  })
})
