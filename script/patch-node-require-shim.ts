#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DIST_PATH = join(SCRIPT_DIR, "..", "dist", "index.js")
const IMPORT_LINE = 'import { createRequire as __omoCreateRequire } from "node:module";'
const BUN_REQUIRE_LINE = "var __require = import.meta.require;"
const NODE_SAFE_REQUIRE_LINE = 'var __require = typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url);'

const original = readFileSync(DIST_PATH, "utf-8")

if (original.includes(NODE_SAFE_REQUIRE_LINE)) {
  console.log("Node/Electron require shim already present in dist/index.js, skipping.")
  process.exit(0)
}

if (!original.includes(BUN_REQUIRE_LINE)) {
  throw new Error(`Expected Bun require helper not found in ${DIST_PATH}`)
}

const patched = original.replace(BUN_REQUIRE_LINE, `${IMPORT_LINE}\n${NODE_SAFE_REQUIRE_LINE}`)

writeFileSync(DIST_PATH, patched, "utf-8")
console.log("Patched Node/Electron require shim in dist/index.js")
