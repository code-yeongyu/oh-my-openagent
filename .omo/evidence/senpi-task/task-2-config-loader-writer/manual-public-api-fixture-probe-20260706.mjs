import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOmoConfig } from "../../../../packages/omo-config-core/src/index.ts"

const roots = []
const observations = {}
let failure

function makeFixture(name) {
  const root = mkdtempSync(join(tmpdir(), `omo-config-public-api-${name}-`))
  roots.push(root)
  const homeDir = join(root, "home")
  const xdgConfigHome = join(root, "xdg")
  const projectDir = join(homeDir, "work", "project")
  const cwd = join(projectDir, "child")
  mkdirSync(cwd, { recursive: true })
  return { cwd, homeDir, projectDir, root, xdgConfigHome }
}

function writeJson(path, content) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

function loadFixture(fixture) {
  return loadOmoConfig({
    cwd: fixture.cwd,
    env: { HOME: fixture.homeDir, XDG_CONFIG_HOME: fixture.xdgConfigHome },
    platform: "linux",
  })
}

function loadedProjectSources(result) {
  return result.sources.filter((source) => source.scope === "project" && source.loaded).map((source) => source.path)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`)
  }
}

function assertArrayEmpty(value, message) {
  if (value.length !== 0) {
    throw new Error(`${message}: ${JSON.stringify(value)}`)
  }
}

try {
  const fileSymlink = makeFixture("file-symlink")
  const fileProjectOmoDir = join(fileSymlink.projectDir, ".omo")
  const fileOutsideConfigPath = join(fileSymlink.homeDir, "outside.jsonc")
  mkdirSync(fileProjectOmoDir, { recursive: true })
  writeJson(fileOutsideConfigPath, `{"task":{"default_concurrency":9}}`)
  symlinkSync(fileOutsideConfigPath, join(fileProjectOmoDir, "omo.jsonc"))
  const fileSymlinkResult = loadFixture(fileSymlink)
  observations.projectConfigFileSymlink = {
    diagnostics: fileSymlinkResult.diagnostics,
    loadedProjectSources: loadedProjectSources(fileSymlinkResult),
    taskDefaultConcurrency: fileSymlinkResult.config.task?.default_concurrency,
  }
  assertEqual(fileSymlinkResult.config.task?.default_concurrency, 5, "project config file symlink target was applied")
  assertArrayEmpty(loadedProjectSources(fileSymlinkResult), "project config file symlink loaded project sources")

  const dirSymlink = makeFixture("dir-symlink")
  const outsideOmoDir = join(dirSymlink.homeDir, "outside-omo")
  mkdirSync(outsideOmoDir, { recursive: true })
  writeJson(join(outsideOmoDir, "omo.jsonc"), `{"task":{"default_concurrency":9}}`)
  symlinkSync(outsideOmoDir, join(dirSymlink.projectDir, ".omo"))
  const dirSymlinkResult = loadFixture(dirSymlink)
  observations.projectOmoDirectorySymlink = {
    diagnostics: dirSymlinkResult.diagnostics,
    loadedProjectSources: loadedProjectSources(dirSymlinkResult),
    taskDefaultConcurrency: dirSymlinkResult.config.task?.default_concurrency,
  }
  assertEqual(dirSymlinkResult.config.task?.default_concurrency, 5, "project omo directory symlink target was applied")
  assertArrayEmpty(loadedProjectSources(dirSymlinkResult), "project omo directory symlink loaded project sources")

  const normalProject = makeFixture("normal-project")
  const normalConfigPath = join(normalProject.projectDir, ".omo", "omo.jsonc")
  writeJson(normalConfigPath, `{"task":{"default_concurrency":8}}`)
  const normalProjectResult = loadFixture(normalProject)
  observations.normalProjectConfig = {
    diagnostics: normalProjectResult.diagnostics,
    loadedProjectSources: loadedProjectSources(normalProjectResult),
    taskDefaultConcurrency: normalProjectResult.config.task?.default_concurrency,
  }
  assertEqual(normalProjectResult.config.task?.default_concurrency, 8, "normal project config did not load")

  const teamsMerge = makeFixture("teams-merge")
  writeJson(
    join(teamsMerge.xdgConfigHome, "omo", "omo.jsonc"),
    `{"teams":{"alpha":{"members":[{"name":"one","kind":"category","category":"quick","prompt":"go"}]}}}`,
  )
  writeJson(join(teamsMerge.projectDir, ".omo", "omo.jsonc"), `{"teams":{"alpha":{"description":"near layer"}}}`)
  const teamsMergeResult = loadFixture(teamsMerge)
  observations.teamsPartialMerge = {
    diagnostics: teamsMergeResult.diagnostics,
    description: teamsMergeResult.config.teams?.alpha?.description,
    firstMemberName: teamsMergeResult.config.teams?.alpha?.members[0]?.name,
  }
  assertEqual(teamsMergeResult.config.teams?.alpha?.description, "near layer", "team description did not merge")
  assertEqual(teamsMergeResult.config.teams?.alpha?.members[0]?.name, "one", "team member did not survive merge")
  observations.assertionsPassed = true
} catch (error) {
  failure = error
  observations.error = error instanceof Error ? error.message : String(error)
} finally {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true })
  }
  observations.cleanupRootsExistAfter = roots.filter((root) => existsSync(root))
  console.log(JSON.stringify(observations, null, 2))
  if (failure !== undefined) {
    process.exitCode = 1
  }
}
