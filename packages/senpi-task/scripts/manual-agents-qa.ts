import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

const finderPath = join(projectDir, ".pi", "agents", "finder.md")
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
const brokenPath = join(projectDir, ".pi", "agent", "broken.md")
writeText(brokenPath, "---\nmodel: [unterminated\n---\nBroken prompt")
const userConfigPath = join(homeDir, ".config", "omo", "omo.jsonc")
mkdirSync(userConfigPath, { recursive: true })
const externalRoot = join(fixtureRoot, "external-agents")
const symlinkedScanRoot = join(projectDir, ".senpi", "agent")
const externalAgentPath = join(externalRoot, "agent", "linked.md")
writeText(externalAgentPath, "---\nmodel: external-model\n---\nExternal prompt\n")
mkdirSync(dirname(symlinkedScanRoot), { recursive: true })
symlinkSync(externalRoot, symlinkedScanRoot, "dir")
const configuredExternalRoot = join(fixtureRoot, "configured-external-agents")
const symlinkedConfiguredRoot = join(projectDir, ".senpi", "agents")
const configuredEscapedAgentPath = join(configuredExternalRoot, "agent", "escaped.md")
writeText(configuredEscapedAgentPath, "---\nmodel: configured-external-model\n---\nConfigured external prompt\n")
mkdirSync(dirname(symlinkedConfiguredRoot), { recursive: true })
symlinkSync(configuredExternalRoot, symlinkedConfiguredRoot, "dir")
const brokenDirectorySymlink = join(projectDir, ".pi", "agents", "nested", "missing")
mkdirSync(dirname(brokenDirectorySymlink), { recursive: true })
symlinkSync(join(projectDir, "missing-directory"), brokenDirectorySymlink, "dir")
const projectConfigPath = join(projectDir, ".omo", "omo.json")
writeText(
  projectConfigPath,
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
if (loaded.agents.linked !== undefined) throw new Error("symlinked external agent loaded")
const symlinkDiagnostic = loaded.diagnostics.find((diagnostic) => diagnostic.path === symlinkedScanRoot)
if (symlinkDiagnostic?.kind !== "read") throw new Error("symlinked scan root diagnostic missing")
if (loaded.agents.escaped !== undefined) throw new Error("symlinked configured-location external agent loaded")
const configuredSymlinkDiagnostic = loaded.diagnostics.find((diagnostic) => diagnostic.path === symlinkedConfiguredRoot)
if (configuredSymlinkDiagnostic?.kind !== "read") throw new Error("symlinked configured-location diagnostic missing")
const brokenDirectoryDiagnostic = loaded.diagnostics.find((diagnostic) => diagnostic.path === brokenDirectorySymlink)
if (brokenDirectoryDiagnostic?.kind !== "read") throw new Error("broken directory symlink diagnostic missing")
const userConfigDiagnostic = loaded.diagnostics.find((diagnostic) => diagnostic.path === userConfigPath)
if (userConfigDiagnostic?.kind !== "read") throw new Error("unreadable user config diagnostic missing")

const summary = {
  finderPath,
  brokenPath,
  projectConfigPath,
  userConfigPath,
  symlinkedScanRoot,
  symlinkedConfiguredRoot,
  externalAgentPath,
  configuredEscapedAgentPath,
  brokenDirectorySymlink,
  loadedAgentNames: Object.keys(loaded.agents).sort(),
  finderModel: finder.model,
  finderModels: finder.models,
  finderReadAllowed: resolveToolRule(finder.tools ?? [], "read"),
  brokenDiagnostic,
  symlinkDiagnostic,
  configuredSymlinkDiagnostic,
  brokenDirectoryDiagnostic,
  userConfigDiagnostic,
  externalAgentLoaded: loaded.agents.linked !== undefined,
  configuredExternalAgentLoaded: loaded.agents.escaped !== undefined,
  fixtureExistedBeforeCleanup: existsSync(fixtureRoot),
}
rmSync(fixtureRoot, { recursive: true, force: true })
console.log(JSON.stringify({ ...summary, fixtureExistsAfterCleanup: existsSync(fixtureRoot) }, null, 2))
