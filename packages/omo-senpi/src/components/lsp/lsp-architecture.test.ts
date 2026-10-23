import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"

const COMPONENT_ROOT = "packages/omo-senpi/src/components/lsp"
const PACKAGE_ROOT = fileURLToPath(new URL("../../..", import.meta.url))
const BUILT_ENTRY_PATH = join(PACKAGE_ROOT, "plugin", "extensions", "omo.js")
// Senpi runs LSP only through the packaged daemon, so lsp-core's in-process engine (manager, client,
// transport, workspace edits: ~82 KB minified) must never reach omo.js. One value import from the
// lsp-core root barrel evaluated every module it re-exports and pulled the whole engine in (#9915).
// These error texts exist only in that engine (lsp/manager.ts and lsp/client.ts).
const IN_PROCESS_ENGINE_MARKERS = [
  "LspManager has been disposed",
  "LSP request cancelled before workspace edit commit",
] as const
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

  test("#given the built entry bundle #when it is inspected #then the in-process LSP engine is absent", () => {
    // given
    expect(existsSync(BUILT_ENTRY_PATH), `missing built extension at ${BUILT_ENTRY_PATH}`).toBe(true)
    const bundle = readFileSync(BUILT_ENTRY_PATH, "utf8")

    // when
    const present = IN_PROCESS_ENGINE_MARKERS.filter((marker) => bundle.includes(marker))

    // then
    expect(present).toEqual([])
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
