#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DIST_PATHS = [
  join(SCRIPT_DIR, "..", "dist", "index.js"),
  join(SCRIPT_DIR, "..", "dist", "hosts", "oh-my-pi", "index.js"),
  join(SCRIPT_DIR, "..", "dist", "hosts", "pi", "index.js"),
]
const IMPORT_LINE = 'import { createRequire as __omoCreateRequire } from "node:module";'
const BUN_REQUIRE_LINE = "var __require = import.meta.require;"
const NODE_SAFE_REQUIRE_LINE = 'var __require = typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url);'

for (const distPath of DIST_PATHS) {
  const original = readFileSync(distPath, "utf-8")

  if (original.includes(NODE_SAFE_REQUIRE_LINE)) {
    console.log(`Node/Electron require shim already present in ${distPath}, skipping.`)
    continue
  }

  if (!original.includes(BUN_REQUIRE_LINE)) {
    throw new Error(`Expected Bun require helper not found in ${distPath}`)
  }

  const patched = original.replace(BUN_REQUIRE_LINE, `${IMPORT_LINE}\n${NODE_SAFE_REQUIRE_LINE}`)

  writeFileSync(distPath, patched, "utf-8")
  console.log(`Patched Node/Electron require shim in ${distPath}`)
}
