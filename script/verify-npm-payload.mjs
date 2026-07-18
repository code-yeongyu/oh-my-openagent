#!/usr/bin/env node

import { execFileSync } from "node:child_process"

const FORBIDDEN_RULES = [
  { name: "nested node_modules", matches: (path) => path.includes("node_modules/") },
  { name: "senpi payload", matches: (path) => path.startsWith("packages/omo-senpi/") },
  { name: "retired workflow-selector component", matches: (path) => path.includes("components/workflow-selector/") },
]

const MAX_REPORTED_OFFENDERS = 50

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

if (offenders.length > 0) {
  console.error(`npm payload containment violation (${offenders.length} offending path(s)):`)
  for (const line of offenders.slice(0, MAX_REPORTED_OFFENDERS)) console.error(`  ${line}`)
  if (offenders.length > MAX_REPORTED_OFFENDERS) {
    console.error(`  ... and ${offenders.length - MAX_REPORTED_OFFENDERS} more`)
  }
  process.exit(1)
}

console.log(`npm payload containment OK (${paths.length} packed paths, 0 offenders)`)
