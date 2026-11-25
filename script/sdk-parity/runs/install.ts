import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { installCore } from "../../../packages/omo-native/bin/lib/sdk-install.js"
import { REAL_SETUP_FS } from "../../../packages/omo-native/bin/lib/setup-fs.js"
import type { ScenarioRun } from "../conformance-run"
import { type ScenarioFakes, scenarioRuns, type SetupOptions } from "../fakes/setup"
import { loadScenarioTable } from "../scenario-table"

// Slice C1c's drivers (#14960): the install namespace's calls on the real omo SDK root, its launcher-side core loaded
// with ports over the scenario's recorder. The setup calls run on a fixture home the loader writes before the first
// call (OpenCode's API key and config), read OpenCode's files and make every write through the setup file port; the
// update call's package manager, dist-tag lookup and installed-version reads are recorded as the process spawns and
// file reads they are. `given` states the fakes' answers: the published version, the installed one before and after,
// how the package manager ends, the platform, a versioned layout and whether bun is there.

const ROWS = [
  "install.setup.detect",
  "install.setup.plan",
  "install.setup.apply",
  "install.update",
  "install.version",
] as const

const OPENCODE_KEY = "sk-c1c-fixture-not-a-secret"

// The framework's fakes name the home "~" and the agent dir "/agent" (fakes/process-fs.ts); these recorded paths do too.
const named = (fakes: ScenarioFakes, path: string): string =>
  path.startsWith(fakes.agentDir)
    ? `/agent${path.slice(fakes.agentDir.length)}`
    : path.startsWith(fakes.home)
      ? `~${path.slice(fakes.home.length)}`
      : path

const exists = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

// The real setup file port, every effect recorded as the write or removal it makes: a rename's destination, a copy's
// target. A temporary file written and renamed into place is one write of its destination.
function recordedSetupFs(fakes: ScenarioFakes) {
  const record = (op: "read" | "write" | "remove", path: string) =>
    fakes.recorder.record("fs", op, { path: named(fakes, path) })
  return {
    ...REAL_SETUP_FS,
    read: (path: string) => {
      record("read", path)
      return REAL_SETUP_FS.read(path)
    },
    rename: (from: string, to: string) => {
      record("write", to)
      REAL_SETUP_FS.rename(from, to)
    },
    copyFile: (from: string, to: string, options?: { exclusive?: boolean }) => {
      record("write", to)
      REAL_SETUP_FS.copyFile(from, to, options)
    },
    copyTree: (from: string, to: string) => {
      record("write", to)
      REAL_SETUP_FS.copyTree(from, to)
    },
    remove: (path: string) => {
      if (!exists(path)) return
      record("remove", path)
      REAL_SETUP_FS.remove(path)
    },
  }
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// OpenCode with one API key (a pending credential) and a config file, under the scenario's home.
function setupFixture(fakes: ScenarioFakes): void {
  writeFile(
    join(fakes.home, ".local", "share", "opencode", "auth.json"),
    JSON.stringify({ google: { type: "api", key: OPENCODE_KEY } }),
  )
  writeFile(join(fakes.home, ".config", "opencode", "opencode.json"), JSON.stringify({ $schema: "opencode" }))
}

// A versioned install: <versions>/<version>/node_modules/omo-ai, with <versions>/current naming that version.
function versionedLayout(fakes: ScenarioFakes, version: string): string {
  const versions = join(fakes.home, ".omo", "versions")
  const versionDir = join(versions, version)
  const packageDir = join(versionDir, "node_modules", "omo-ai")
  mkdirSync(packageDir, { recursive: true })
  writeFile(join(versionDir, "package.json"), JSON.stringify({ dependencies: { "omo-ai": version } }))
  symlinkSync(versionDir, join(versions, "current"))
  return packageDir
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const number = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)

function updatePorts(fakes: ScenarioFakes) {
  const process = fakes.recorder.given("process")
  const fs = fakes.recorder.given("fs")
  const latest = text(process["registry_latest"])
  const before = text(fs["installed"]) ?? "1.0.0"
  const after = text(fs["installed_after"]) ?? latest ?? before
  let ran = false
  const readInstalled = () => {
    fakes.recorder.record("fs", "read", { path: "<package>/package.json" })
    return { omo: ran ? after : before, engine: fs["engine"] === "missing" ? "unknown" : "1" }
  }
  return {
    env: { HOME: fakes.home, PATH: "" },
    platform: text(process["platform"]) ?? "linux",
    root: fs["layout"] === "versioned" ? versionedLayout(fakes, before) : join(fakes.home, "no-install"),
    sleep: async () => {},
    listProcesses: () => [],
    readInstalled,
    fetchDistTags: () => {
      fakes.recorder.record("process", "spawn", { command: "node", script: "omo-ai/dist-tags" })
      return latest === undefined ? null : { latest }
    },
    resolveUpdate: (version?: string) => {
      const spec = version === undefined ? "omo-ai@latest" : `omo-ai@${version}`
      return { manager: "npm", command: `npm install -g ${spec}`, argv: ["npm", "install", "-g", spec] }
    },
    run: async (command: string, argv: readonly string[]) => {
      fakes.recorder.record("process", "spawn", { command, argv: [...argv] })
      if (process["npm"] === "missing") throw new Error(`spawn ${command} ENOENT`)
      if (text(process["npm_held"]) !== undefined)
        return {
          status: 1,
          signal: null,
          stderr: `npm error code ${process["npm_held"]}\nnpm error path C:\\omo\\omo.exe`,
        }
      ran = true
      return { status: number(process["npm_exit"]) ?? 0, signal: null }
    },
  }
}

function versionPorts(fakes: ScenarioFakes) {
  return {
    read: () => {
      fakes.recorder.record("fs", "read", { path: "<package>/package.json" })
      fakes.recorder.record("fs", "read", { path: "<senpi>/package.json" })
      return { version: "1.0.0", engine: "2026.11.25" }
    },
  }
}

// The engine's model runtime the setup summary's coverage line reads: absent, unless the scenario gives a malformed one,
// whose answer the summary cannot project (the setup plan's unexpected fault).
function coverageRuntime(fakes: ScenarioFakes): unknown {
  if (fakes.recorder.given("engine")["coverage"] !== "malformed") throw new Error("no coverage runtime in a scenario")
  return { categoryCoverage: () => ({ usable: null, unusable: null }) }
}

const installCores: SetupOptions["cores"] = (fakes) => ({
  install: async (context) => {
    setupFixture(fakes)
    return installCore(context, {
      update: updatePorts(fakes),
      version: versionPorts(fakes),
      setup: { fs: recordedSetupFs(fakes), loadCoverageRuntime: async () => coverageRuntime(fakes) },
    })
  },
})

const ids = loadScenarioTable()
  .flatMap((file) => file.scenarios)
  .filter((scenario) => (ROWS as readonly string[]).includes(scenario.row))
  .map((scenario) => scenario.id)

export const runs: ScenarioRun[] = scenarioRuns(
  [...ROWS],
  Object.fromEntries(ids.map((id) => [id, { cores: installCores }])),
)
