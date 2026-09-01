import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const BOUNDARY_DIR = path.join(SOURCE_ROOT, "fs") + path.sep
const DIRECT_NODE_FS = /(?:from\s*|require\s*\(\s*|import\s*\(\s*|import\s+)["']node:fs(?:\/promises)?["']/

function collectSourceFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath))
      continue
    }
    if (!entry.name.endsWith(".ts")) continue
    if (entry.name.endsWith(".test.ts")) continue
    if (entry.name.includes("test-support")) continue
    files.push(entryPath)
  }
  return files
}

describe("memory-core fs boundary", () => {
  test("the detector catches every direct node:fs import form", () => {
    const escapes = [
      'import { readFile } from "node:fs/promises"',
      "import { readFile } from 'node:fs/promises'",
      'const fs = await import("node:fs")',
      "const fs = await import('node:fs')",
      'import "node:fs"',
      'const fs = require("node:fs")',
      "const fs = require('node:fs')",
    ]
    for (const sample of escapes) {
      expect(DIRECT_NODE_FS.test(sample)).toBe(true)
    }
    const allowed = [
      'import { readFile } from "../fs/resilient"',
      'import { x } from "node:fstream"',
      'from "@oh-my-opencode/memory-core/fs"',
    ]
    for (const sample of allowed) {
      expect(DIRECT_NODE_FS.test(sample)).toBe(false)
    }
  })

  test("production sources import fs only through the resilient module", () => {
    const offenders = collectSourceFiles(SOURCE_ROOT)
      .filter((file) => !file.startsWith(BOUNDARY_DIR))
      .filter((file) => DIRECT_NODE_FS.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SOURCE_ROOT, file))
    expect(offenders).toEqual([])
  })
})
