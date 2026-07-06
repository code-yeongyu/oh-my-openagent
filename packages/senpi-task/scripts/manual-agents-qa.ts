import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { loadAgents, resolveToolRule } from "../src/index"

const evidenceDir = process.argv[2]
if (evidenceDir === undefined) throw new Error("Usage: bun packages/senpi-task/scripts/manual-agents-qa.ts <evidence-dir>")

const fixtureRoot = join(resolve(evidenceDir), "manual-agents-fixture")
const homeDir = join(fixtureRoot, "home")
const projectDir = join(fixtureRoot, "project")
rmSync(fixtureRoot, { recursive: true, force: true })

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

const finderPath = join(projectDir, ".senpi", "agent", "finder.md")
writeText(
  finderPath,
  `---
description: Finds facts
models:
  - file-primary
  - file-fallback
tools:
  - pattern: read
    action: allow
---
Finder prompt
`,
)
const brokenPath = join(projectDir, ".senpi", "agent", "broken.md")
writeText(brokenPath, "---\nmodel: [unterminated\n---\nBroken prompt")
writeText(
  join(projectDir, ".omo", "omo.json"),
  JSON.stringify({
    agents: {
      finder: {
        model: "omo-override",
        execution_mode: "process",
      },
    },
  }),
)

const loaded = loadAgents({ homeDir, projectDir })
const finder = loaded.agents.finder
if (finder === undefined) throw new Error("finder did not load")
if (finder.model !== "omo-override") throw new Error("omo.json model override did not win")
if (finder.models?.[0] !== "file-primary") throw new Error("finder models fallback list did not load")
if (resolveToolRule(finder.tools ?? [], "read") !== true) throw new Error("finder read tool allow did not load")
const brokenDiagnostic = loaded.diagnostics.find((diagnostic) => diagnostic.path === brokenPath)
if (brokenDiagnostic?.kind !== "frontmatter") throw new Error("broken frontmatter diagnostic missing")

const summary = {
  finderPath,
  brokenPath,
  loadedAgentNames: Object.keys(loaded.agents).sort(),
  finderModel: finder.model,
  finderModels: finder.models,
  finderReadAllowed: resolveToolRule(finder.tools ?? [], "read"),
  brokenDiagnostic,
  fixtureExistedBeforeCleanup: existsSync(fixtureRoot),
}
rmSync(fixtureRoot, { recursive: true, force: true })
console.log(JSON.stringify({ ...summary, fixtureExistsAfterCleanup: existsSync(fixtureRoot) }, null, 2))
