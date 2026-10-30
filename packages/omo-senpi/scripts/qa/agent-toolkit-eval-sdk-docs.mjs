#!/usr/bin/env node
// Validates the Native ulw-loop guidance: every shipped copy must teach the eval SDK import and
// must not steer the model toward the removed omo_agent_toolkit tool or a Native CLI spawn. The
// hand-written sources are scanned too, and each generated copy must match its source. Codex-only
// copies keep their CLI instructions and are deliberately not scanned.
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
// The import line the model copies verbatim into a JS eval cell.
const REQUIRED_IMPORT = /await import\(`\$\{env\("OMO_AGENT_TOOLKIT_SDK_ROOT"\)\}\/sdk\.js`\)/
// Guidance that would send the model to the removed tool or to a CLI spawn.
const FORBIDDEN = /tool\.omo_agent_toolkit|omo_agent_toolkit\(|omo-agent-toolkit ulw-loop|--session-id/

function fail(message) {
  console.error(`agent-toolkit-eval-sdk-docs: ${message}`)
  process.exitCode = 1
}

function checkFiles(files, label) {
  for (const file of files) {
    if (!existsSync(file)) {
      fail(`missing ${label} guidance: ${file}`)
      continue
    }
    const text = readFileSync(file, "utf8")
    if (!REQUIRED_IMPORT.test(text)) fail(`${label} guidance never teaches the eval SDK import: ${file}`)
    const forbidden = text.match(FORBIDDEN)
    if (forbidden) fail(`${label} guidance still points at the removed tool or a CLI spawn (${forbidden[0]}): ${file}`)
  }
}

function checkDriverLifecycle() {
  const skill = GENERATED[0]
  if (!existsSync(skill)) return
  if (!readFileSync(skill, "utf8").includes("Driver goal lifecycle")) {
    fail(`generated ulw-loop skill lost the driver-lifecycle section: ${skill}`)
  }
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

checkFiles(SOURCES, "source")
checkFiles(GENERATED, "generated")
checkDriverLifecycle()
checkSourcesMatchGenerated()
if (process.exitCode === undefined || process.exitCode === 0) {
  console.log(`agent-toolkit-eval-sdk-docs: Native guidance teaches the eval SDK import (${GENERATED.length + SOURCES.length} files checked, repo ${repoRoot})`)
}
