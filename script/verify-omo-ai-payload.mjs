#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { npmSpawnOptions } from "./npm-invocation.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const pkgDir = resolve(repoRoot, "packages", "omo-native")

const REQUIRED_ARTIFACTS = [
  "bin/omo.js",
  "plugin/package.json",
  "plugin/CHANGELOG.md",
  "plugin/extensions/omo.js",
  // The session gateway's SQLite store runs as a worker thread started from this sidecar beside omo.js.
  "plugin/extensions/gateway-store-worker.mjs",
  // Credential-gated skill: not under plugin/skills (never eager-loaded) but the bundled x-search
  // component resolves ../skills-conditional/x-search/SKILL.md, so the payload must ship it.
  "plugin/skills-conditional/x-search/SKILL.md",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/dag/sdk.js",
  "plugin/runtime/agent-toolkit-sdk/sdk.js",
  // omo thread and omo daemon adopt import it (bin/lib/thread.js).
  "plugin/runtime/thread-sdk/sdk.js",
  // omo doctor / omo setup classify task-category coverage through it (bin/lib/category-coverage.js).
  "plugin/runtime/category-coverage/index.js",
  // That bundle inlines the computer-use doctor, which reads the prelude assets from beside itself (#9193).
  "plugin/runtime/category-coverage/assets.generated.json",
  // omo daemon resolves its settings (task.host_engine_policy and task.host_idle_exit_ms) through the config
  // loader with it (bin/lib/daemon-config.js).
  "plugin/runtime/task-config/index.js",
]

// A bundle that reads `join(dirname(fileURLToPath(import.meta.url)), "<file>")` needs <file> packed
// next to it; minified bundles keep this shape with renamed helpers, so the helper names are not matched.
const SIBLING_ASSET_READ_RE = /import\.meta\.url\s*\)\s*\)\s*,\s*["']([\w.-]+\.[A-Za-z]\w*)["']/g
const BUNDLE_PATH_RE = /\.m?js$/

const MIN_SKILL_COUNT = 18
const SKILL_PATH_RE = /^plugin\/skills\/[^/]+\/SKILL\.md$/

const FORBIDDEN_RULES = [
  { name: "nested node_modules", matches: (path) => path.includes("node_modules/") },
  { name: "source directory", matches: (path) => path.startsWith("src/") },
  { name: "test directory", matches: (path) => path.startsWith("test/") },
  { name: "test file", matches: (path) => path.includes(".test.") },
]

const MAX_UNPACKED_SIZE = 30 * 1024 * 1024

const MAX_REPORTED_OFFENDERS = 50

function packedPaths() {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: pkgDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    ...npmSpawnOptions(),
  })
  const [result] = JSON.parse(raw)
  if (!result) return { paths: [], unpackedSize: 0 }
  return {
    paths: result.files.map((file) => file.path),
    unpackedSize: result.unpackedSize ?? 0,
  }
}

const errors = []
let paths = []
let unpackedSize = 0

try {
  if (!existsSync(pkgDir)) {
    throw new Error(`package directory not found: ${pkgDir}`)
  }
  if (!existsSync(resolve(pkgDir, "package.json"))) {
    throw new Error(`package.json not found in ${pkgDir}`)
  }
  ;({ paths, unpackedSize } = packedPaths())
} catch (err) {
  errors.push(`npm pack failed: ${err.message}`)
}

const pathSet = new Set(paths)

for (const artifact of REQUIRED_ARTIFACTS) {
  if (!pathSet.has(artifact)) {
    errors.push(`missing artifact: ${artifact}`)
  }
}

for (const path of paths.filter((p) => BUNDLE_PATH_RE.test(p))) {
  const source = readFileSync(resolve(pkgDir, path), "utf8")
  for (const asset of new Set(Array.from(source.matchAll(SIBLING_ASSET_READ_RE), (match) => match[1]))) {
    const sibling = posix.join(posix.dirname(path), asset)
    if (!pathSet.has(sibling)) {
      errors.push(`missing sibling asset: ${path} reads ${sibling}, which is not packed`)
    }
  }
}

const skillCount = paths.filter((p) => SKILL_PATH_RE.test(p)).length
if (skillCount < MIN_SKILL_COUNT) {
  errors.push(
    `missing: expected >= ${MIN_SKILL_COUNT} skill files (plugin/skills/*/SKILL.md), found ${skillCount}`,
  )
}

if (paths.length > 0) {
  const offenders = paths.flatMap((path) => {
    const rule = FORBIDDEN_RULES.find((candidate) => candidate.matches(path))
    return rule ? [`${rule.name}: ${path}`] : []
  })

  if (offenders.length > 0) {
    errors.push(`forbidden paths (${offenders.length} offending path(s)):`)
    for (const line of offenders.slice(0, MAX_REPORTED_OFFENDERS)) {
      errors.push(`  ${line}`)
    }
    if (offenders.length > MAX_REPORTED_OFFENDERS) {
      errors.push(`  ... and ${offenders.length - MAX_REPORTED_OFFENDERS} more`)
    }
  }

  if (unpackedSize >= MAX_UNPACKED_SIZE) {
    errors.push(
      `unpacked size ${unpackedSize} bytes exceeds limit ${MAX_UNPACKED_SIZE} bytes (30 MB)`,
    )
  }
}

if (errors.length > 0) {
  console.error(`omo-ai payload verification FAILED (${errors.length} issue(s)):`)
  for (const line of errors) {
    console.error(`  ${line}`)
  }
  process.exit(1)
}

console.log(
  `omo-ai payload verification OK (${paths.length} packed paths, 0 offenders, ${unpackedSize} bytes)`,
)
