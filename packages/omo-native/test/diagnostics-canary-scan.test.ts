// Security evidence (#14959, security design 4.3): `diagnostics.run` is a read a session may make only once
// a canary scan shows its output cannot carry a credential. A synthetic canary is planted in turn in each
// input a finding reads, and the scan records which ones reach any field of any finding. Today some do,
// by parity with `omo doctor`'s output, so the call stays refused to a session; a change that empties the
// set is the evidence that would let the security owner lift that refusal.
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DiagnosticsCalls, RunPorts } from "../bin/lib/diagnostics-contract"
import { models } from "../bin/lib/diagnostics.js"
import { asInstall, createInstall, importInstalled, type Install } from "./doctor-golden.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const quiet = (install: Install): RunPorts => ({
  inventory: { harnesses: [] },
  env: { PATH: install.emptyBin, HOME: install.home, OMO_MEMORY_HOME: install.memory },
  homeDir: install.home,
  fetchDistTags: () => null,
  list: () => [],
  keychainHelper: () => [],
  daemon: () => [],
  configDiagnostics: async () => [],
  reflectionLock: async () => [],
  memoryRuntime: async () => [],
  computerUse: async () => [],
  categoryCoverage: async () => [],
})

type Plant = (install: Install, canary: string) => RunPorts

const PLANTS: Record<string, Plant> = {
  "registry entry": (install, canary) => ({
    ...quiet(install),
    fetchDistTags: () => ({ beta: canary, latest: canary }),
  }),
  "config value": (install, canary) => {
    writeFileSync(join(install.agentDir, "settings.json"), `{ "packages": ["${canary}"`)
    return quiet(install)
  },
  "package source": (install, canary) => {
    writeFileSync(join(install.agentDir, "settings.json"), JSON.stringify({ packages: [canary] }))
    return quiet(install)
  },
  "server URL": (install, canary) => ({
    ...quiet(install),
    env: { ...quiet(install).env, OMO_SERVICE_API_URL: `https://${canary}.example.invalid` },
  }),
  "environment value": (install, canary) => {
    const agentDir = join(install.root, canary)
    mkdirSync(agentDir, { recursive: true })
    return { ...quiet(install), env: { ...quiet(install).env, OMO_CODING_AGENT_DIR: agentDir } }
  },
}

test("#given a canary planted in turn in each input a finding reads #when diagnostics.run answers #then the inputs whose canary reaches a finding are exactly the recorded ones", async () => {
  const reached: string[] = []
  for (const [input, plant] of Object.entries(PLANTS)) {
    const install = createInstall(roots)
    const canary = `canary${input.replace(/\W/g, "")}7f3a9c`
    const core = await importInstalled<DiagnosticsCalls>(install, "bin/lib/diagnostics.js")
    const result = await asInstall(install, () => core.run({}, plant(install, canary)))
    if (JSON.stringify(result).includes(canary)) reached.push(input)
  }
  expect(reached).toEqual(["registry entry", "environment value"])
})

type ModelsPlant = (home: string, agentDir: string, canary: string) => Record<string, string>

const MODELS_PLANTS: Record<string, ModelsPlant> = {
  "config value": (home, _agentDir, canary) => {
    writeFileSync(
      join(home, ".omo", "omo.json"),
      JSON.stringify({ categories: { quick: { model: `anthropic/${canary}` } } }),
    )
    return {}
  },
  "provider key in the credential store": (_home, agentDir, canary) => {
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: canary } }))
    return {}
  },
  "provider key in the environment": (_home, _agentDir, canary) => ({ ANTHROPIC_API_KEY: canary }),
}

test("#given a canary planted in turn in each input the model view reads #when diagnostics.models answers #then the inputs whose canary reaches the view are exactly the recorded ones", async () => {
  const reached: string[] = []
  for (const [input, plant] of Object.entries(MODELS_PLANTS)) {
    const home = mkdtempSync(join(tmpdir(), "omo-models-canary-"))
    roots.push(home)
    const agentDir = join(home, ".omo", "agent")
    mkdirSync(agentDir, { recursive: true })
    const canary = `canary${input.replace(/\W/g, "")}4d1e8b`
    const env = { HOME: home, ...plant(home, agentDir, canary) }
    const result = await models(
      {},
      { agentDir, cwd: home, env, loadRuntime: () => import("../category-coverage-entry") },
    )
    expect(result.kind).toBe("ok")
    if (JSON.stringify(result).includes(canary)) reached.push(input)
  }
  expect(reached).toEqual(["config value"])
})
