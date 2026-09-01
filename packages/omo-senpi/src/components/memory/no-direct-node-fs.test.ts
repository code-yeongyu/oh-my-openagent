import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const COMPONENT_ROOT = path.resolve(import.meta.dir)
const DIRECT_NODE_FS = /(?:from\s*|require\s*\(\s*|import\s*\(\s*|import\s+)["']node:fs(?:\/promises)?["']/

function collectSourceFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__fixtures__") continue
      files.push(...collectSourceFiles(entryPath))
      continue
    }
    if (!entry.name.endsWith(".ts")) continue
    if (entry.name.endsWith(".test.ts")) continue
    if (entry.name.includes("test-support")) continue
    // Carries the memorian gate child's materialized `-e` extension as an embedded source string.
    // That generated child file must stay dependency-free (it loads outside this package's module
    // graph), so its `node:fs` import lives inside the template literal, not this module's imports.
    if (entry.name === "memorian-nudge-extension.ts") continue
    files.push(entryPath)
  }
  return files
}

describe("memory component fs boundary", () => {
  test("#given every direct node:fs import form #when the detector scans it #then each form is caught", () => {
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
      'import { readdirSync } from "@oh-my-opencode/memory-core/fs"',
      'import { x } from "node:fstream"',
    ]
    for (const sample of allowed) {
      expect(DIRECT_NODE_FS.test(sample)).toBe(false)
    }
  })

  test("#given the memory component sources #when scanned #then fs is imported only through the resilient boundary", () => {
    const offenders = collectSourceFiles(COMPONENT_ROOT)
      .filter((file) => DIRECT_NODE_FS.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(COMPONENT_ROOT, file))
    expect(offenders).toEqual([])
  })
})
