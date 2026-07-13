import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, test } from "bun:test"

const COMPONENT_ROOT = "packages/omo-senpi/src/components/lsp"
const REMOVED_ENGINE_PATHS = [
  "client-wrapper.ts",
  "client.ts",
  "connection.ts",
  "directory-diagnostics.ts",
  "errors.ts",
  "infer-extension.ts",
  "inspector.ts",
  "manager-default.ts",
  "manager-lifecycle.ts",
  "manager-types.ts",
  "manager-wait.ts",
  "manager.ts",
  "process.ts",
  "server-installation.ts",
  "server-resolution.ts",
  "transport.ts",
  "workspace-edit.ts",
].map((file) => ["lsp", file].join("/"))

const RETAINED_SOURCE_DIRS = ["adapter", "."] as const
const FORBIDDEN_ACTIVE_PATTERNS = [
  ["vscode", "jsonrpc"].join("-"),
  ["OMO", "SENPI", "TRUST", "PROJECT", "LSP", "COMMANDS"].join("_"),
  ["SENPI", "TRUST", "PROJECT", "LSP", "COMMANDS"].join("_"),
] as const

describe("omo-senpi lsp architecture boundary", () => {
  test("#given the daemon-backed adapter #when source shape is audited #then no vendored LSP engine remains", () => {
    // given / when
    const remainingEnginePaths = REMOVED_ENGINE_PATHS.filter((path) => existsSync(join(COMPONENT_ROOT, path)))
    const sourceFiles = listSourceFiles(COMPONENT_ROOT)
    const activePatternHits = collectPatternHits([
      "packages/omo-senpi/package.json",
      "packages/omo-senpi/plugin/package.json",
      ...sourceFiles,
    ])

    // then
    expect(remainingEnginePaths).toEqual([])
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
  if (relativePath.includes("/")) return false
  return RETAINED_SOURCE_DIRS.includes(".")
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
