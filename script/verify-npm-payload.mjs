#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const FORBIDDEN_RULES = [
  { name: "nested node_modules", matches: (path) => path.includes("node_modules/") },
  { name: "senpi payload", matches: (path) => path.startsWith("packages/omo-senpi/") },
  { name: "retired workflow-selector component", matches: (path) => path.includes("components/workflow-selector/") },
]

const MAX_REPORTED_OFFENDERS = 50

// The omo-codex plugin's install-time scripts import @oh-my-opencode/shared-skills subpaths, and
// the lazycodex-ai publish step curates its own `files` list in the workflow. Every export target
// of the shared-skills package must therefore be in the payload, or a registry install dies at
// `npm run sync:skills` (lazycodex-ai@5.0.0-beta.43 shipped without skill-source-filter.mjs).
function requiredSharedSkillsPaths() {
  const manifest = JSON.parse(readFileSync("packages/shared-skills/package.json", "utf8"))
  // Runtime targets only: a missing .d.ts cannot break an install, a missing .mjs does.
  const targets = Object.values(manifest.exports ?? {}).flatMap((entry) =>
    typeof entry === "string" ? [entry] : [entry?.import, entry?.default].filter((target) => typeof target === "string"),
  )
  return [...new Set(targets.map((target) => `packages/shared-skills/${target.replace(/^\.\//, "")}`))]
}

function packedPaths() {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  })
  const [result] = JSON.parse(raw)
  return result.files.map((file) => file.path)
}

const paths = packedPaths()
const offenders = paths.flatMap((path) => {
  const rule = FORBIDDEN_RULES.find((candidate) => candidate.matches(path))
  return rule ? [`${rule.name}: ${path}`] : []
})

const packed = new Set(paths)
const missing = requiredSharedSkillsPaths().filter((path) => !packed.has(path))
if (missing.length > 0) {
  console.error(`npm payload is missing shared-skills export targets the plugin imports (${missing.length}):`)
  for (const line of missing) console.error(`  ${line}`)
  process.exit(1)
}

if (offenders.length > 0) {
  console.error(`npm payload containment violation (${offenders.length} offending path(s)):`)
  for (const line of offenders.slice(0, MAX_REPORTED_OFFENDERS)) console.error(`  ${line}`)
  if (offenders.length > MAX_REPORTED_OFFENDERS) {
    console.error(`  ... and ${offenders.length - MAX_REPORTED_OFFENDERS} more`)
  }
  process.exit(1)
}

console.log(`npm payload containment OK (${paths.length} packed paths, 0 offenders)`)
