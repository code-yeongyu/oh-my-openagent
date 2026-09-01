#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
const pkgDir = resolve(repoRoot, "packages", "omo-native")

const REQUIRED_ARTIFACTS = [
  "bin/omo.js",
  "bin/omo-agent-toolkit.js",
  "plugin/package.json",
  "plugin/extensions/omo.js",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/agent-toolkit/cli.js",
  "plugin/runtime/agent-toolkit/ulw-loop/cli.js",
  "plugin/runtime/agent-toolkit/omo-agent-toolkit",
  "plugin/runtime/agent-toolkit/omo-agent-toolkit.cmd",
  "plugin/runtime/dag/sdk.js",
]

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
