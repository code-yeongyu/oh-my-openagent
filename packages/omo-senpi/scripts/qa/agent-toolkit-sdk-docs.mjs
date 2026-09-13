#!/usr/bin/env node
// Validates the generated Native guidance: the shipped ulw-loop skills must drive the loop through
// the registered tool, must not instruct a Native CLI spawn, and must carry a machine-readable tool
// example. Codex-only copies keep their CLI instructions and are deliberately not scanned.
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(scriptDir, "..", "..")
const repoRoot = join(packageRoot, "..", "..")

const GENERATED = [
  join(packageRoot, "plugin", "skills", "ulw-loop", "SKILL.md"),
  join(packageRoot, "plugin", "skills", "ulw-loop", "references", "full-workflow.md"),
  join(packageRoot, "plugin", "skills", "ulw-research", "SKILL.md"),
]
const SOURCES = [
  join(packageRoot, "skills", "ulw-loop", "SKILL.md"),
  join(packageRoot, "skills", "ulw-loop", "references", "full-workflow.md"),
  join(packageRoot, "skills", "ulw-research", "SKILL.md"),
]
// A machine-readable call the model can copy verbatim, not prose about a tool.
const TOOL_EXAMPLE = /tool\.omo_agent_toolkit\(\{\s*operation:\s*"[a-z-]+"/
const FORBIDDEN_CLI = /omo-agent-toolkit ulw-loop /

function fail(message) {
  console.error(`agent-toolkit-sdk-docs: ${message}`)
  process.exitCode = 1
}

function checkGenerated() {
  for (const file of GENERATED) {
    if (!existsSync(file)) {
      fail(`missing generated guidance: ${file}`)
      continue
    }
    const text = readFileSync(file, "utf8")
    if (FORBIDDEN_CLI.test(text)) fail(`generated guidance still instructs a Native CLI spawn: ${file}`)
  }
}

function checkToolExample() {
  const skill = GENERATED[0]
  if (!existsSync(skill)) return fail(`missing generated guidance: ${skill}`)
  const text = readFileSync(skill, "utf8")
  if (!TOOL_EXAMPLE.test(text)) fail(`generated ulw-loop skill has no machine-readable tool example: ${skill}`)
  if (!text.includes("Driver goal lifecycle")) fail(`generated ulw-loop skill lost the driver-lifecycle section: ${skill}`)
}

function checkSourcesMatchGenerated() {
  for (let index = 0; index < SOURCES.length; index += 1) {
    const source = SOURCES[index]
    const generated = GENERATED[index]
    if (!existsSync(source) || !existsSync(generated)) continue
    const normalize = (value) => value.replace(/\n{2,}/g, "\n\n").trim()
    if (normalize(readFileSync(source, "utf8")) !== normalize(readFileSync(generated, "utf8"))) {
      fail(`generated copy drifted from its source: ${generated}`)
    }
  }
}

const args = new Set(process.argv.slice(2))
const runAll = args.size === 0
if (runAll || args.has("--check-generated")) {
  checkGenerated()
  checkSourcesMatchGenerated()
}
if (runAll || args.has("--check-tool-example")) checkToolExample()
if (process.exitCode === undefined || process.exitCode === 0) {
  console.log(`agent-toolkit-sdk-docs: generated Native guidance is tool-routed (${GENERATED.length} files checked, repo ${repoRoot})`)
}
