import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, test } from "bun:test"

const COMPONENT_ROOT = "packages/omo-senpi/src/components/lsp"
const FORBIDDEN_ACTIVE_PATTERNS = [
  ["vscode", "jsonrpc"].join("-"),
  ["OMO", "SENPI", "TRUST", "PROJECT", "LSP", "COMMANDS"].join("_"),
  ["SENPI", "TRUST", "PROJECT", "LSP", "COMMANDS"].join("_"),
] as const

describe("omo-senpi lsp architecture boundary", () => {
  test("#given the daemon-backed adapter #when source shape is audited #then no vendored LSP engine remains", () => {
    // given / when
    const sourceFiles = listSourceFiles(COMPONENT_ROOT)
    const activePatternHits = collectPatternHits([
      "packages/omo-senpi/package.json",
      "packages/omo-senpi/plugin/package.json",
      ...sourceFiles,
    ])

    // then
    expect(activePatternHits).toEqual([])
    expect(sourceFiles.every(isRetainedLspSource)).toBe(true)
  })
})

function listSourceFiles(root: string): readonly string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path))
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))) {
      files.push(path)
    }
  }
  return files.sort()
}

function isRetainedLspSource(path: string): boolean {
  const relativePath = relative(COMPONENT_ROOT, path)
  if (relativePath.startsWith("adapter/")) return true
  // Top-level adapter files are retained; any other nested directory would be a re-vendored engine.
  return !relativePath.includes("/")
}

function collectPatternHits(paths: readonly string[]): readonly string[] {
  const hits: string[] = []
  for (const path of paths) {
    const source = readFileSync(path, "utf8")
    for (const pattern of FORBIDDEN_ACTIVE_PATTERNS) {
      if (source.includes(pattern)) {
        hits.push(`${path}: ${pattern}`)
      }
    }
  }
  return hits
}
