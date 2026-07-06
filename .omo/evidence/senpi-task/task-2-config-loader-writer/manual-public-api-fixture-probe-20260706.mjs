import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadOmoConfig } from "../../../../packages/omo-config-core/src/index.ts"

function writeJsonc(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function assertProbe(condition, message) {
  if (!condition) throw new Error(message)
}

function makeFixture(root, name) {
  const homeDir = join(root, name, "home")
  const xdgConfigHome = join(root, name, "xdg")
  const projectDir = join(homeDir, "work", "project")
  const cwd = join(projectDir, "child")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, projectDir, xdgConfigHome }
}

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = mkdtempSync(join(evidenceDir, "manual-public-api-fixture-"))
const report = {
  fixtureRoot,
  scenarios: {},
}

try {
  const symlinkFixture = makeFixture(fixtureRoot, "symlink")
  const outsideConfigDir = join(fixtureRoot, "outside-omo")
  writeJsonc(join(outsideConfigDir, "omo.jsonc"), `{"task":{"default_concurrency":9}}`)
  symlinkSync(outsideConfigDir, join(symlinkFixture.projectDir, ".omo"))
  const symlinkResult = loadOmoConfig({
    cwd: symlinkFixture.cwd,
    env: { HOME: symlinkFixture.homeDir, XDG_CONFIG_HOME: symlinkFixture.xdgConfigHome },
    platform: "linux",
  })
  const symlinkProjectSources = symlinkResult.sources.filter((source) => source.scope === "project")
  assertProbe(symlinkResult.config.task?.default_concurrency === 5, "symlink target config was applied")
  assertProbe(symlinkProjectSources.every((source) => !source.loaded), "symlinked project source was loaded")
  report.scenarios.symlinkedProjectOmo = {
    diagnostics: symlinkResult.diagnostics,
    loadedProjectSources: symlinkProjectSources,
    taskDefaultConcurrency: symlinkResult.config.task?.default_concurrency,
  }

  const normalFixture = makeFixture(fixtureRoot, "normal")
  const normalConfigPath = join(normalFixture.projectDir, ".omo", "omo.jsonc")
  writeJsonc(normalConfigPath, `{"task":{"default_concurrency":7}}`)
  const normalResult = loadOmoConfig({
    cwd: normalFixture.cwd,
    env: { HOME: normalFixture.homeDir, XDG_CONFIG_HOME: normalFixture.xdgConfigHome },
    platform: "linux",
  })
  assertProbe(normalResult.config.task?.default_concurrency === 7, "normal project config did not load")
  report.scenarios.normalProjectOmo = {
    diagnostics: normalResult.diagnostics,
    loadedProjectSources: normalResult.sources.filter((source) => source.scope === "project" && source.loaded),
    taskDefaultConcurrency: normalResult.config.task?.default_concurrency,
  }

  const teamsFixture = makeFixture(fixtureRoot, "teams")
  writeJsonc(
    join(teamsFixture.xdgConfigHome, "omo", "omo.jsonc"),
    `{
      "teams": {
        "alpha": {
          "members": [{ "name": "one", "kind": "category", "category": "quick", "prompt": "go" }]
        }
      }
    }`,
  )
  writeJsonc(
    join(teamsFixture.projectDir, ".omo", "omo.jsonc"),
    `{
      "teams": {
        "alpha": {
          "description": "near layer description"
        }
      }
    }`,
  )
  const teamsResult = loadOmoConfig({
    cwd: teamsFixture.cwd,
    env: { HOME: teamsFixture.homeDir, XDG_CONFIG_HOME: teamsFixture.xdgConfigHome },
    platform: "linux",
  })
  assertProbe(teamsResult.config.teams?.alpha?.members?.[0]?.name === "one", "team members were not preserved")
  assertProbe(
    teamsResult.config.teams?.alpha?.description === "near layer description",
    "team description was not merged",
  )
  report.scenarios.sameKeyTeamPartialMerge = {
    diagnostics: teamsResult.diagnostics,
    alpha: teamsResult.config.teams?.alpha,
  }
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true })
}

report.cleanup = {
  fixtureRootExistsAfterCleanup: existsSync(fixtureRoot),
}
assertProbe(report.cleanup.fixtureRootExistsAfterCleanup === false, "fixture cleanup did not remove root")

console.log(JSON.stringify(report, null, 2))
