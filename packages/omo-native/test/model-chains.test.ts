import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { doctorModelChains, runDoctorModels } from "../bin/lib/model-chains.js"
import { teardownRoots } from "./teardown.test-support"

// The real pinned engine reads the fixture auth.json, and the real resolver entry the build bundles
// answers; only HOME, the agent dir and omo.json are fixtures.
const loadRuntime = () => import("../category-coverage-entry")
const roots: string[] = []
afterEach(() => teardownRoots(roots))

const CREDENTIAL_ENV = /(API_KEY|_TOKEN|_KEY$|^AWS_|^GOOGLE_|^VERTEX|^AZURE_)/
const savedEnv: Record<string, string> = {}
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (CREDENTIAL_ENV.test(name) && value !== undefined) {
      savedEnv[name] = value
      delete process.env[name]
    }
  }
})
afterAll(() => Object.assign(process.env, savedEnv))

function sandbox(omoJson: Record<string, unknown>): { readonly home: string; readonly agentDir: string } {
  const home = mkdtempSync(join(tmpdir(), "omo-doctor-models-"))
  roots.push(home)
  const agentDir = join(home, ".omo", "agent")
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "dummy" } }))
  writeFileSync(join(home, ".omo", "omo.json"), JSON.stringify(omoJson))
  return { home, agentDir }
}

async function view(omoJson: Record<string, unknown>) {
  const { home, agentDir } = sandbox(omoJson)
  const result = await doctorModelChains({ agentDir, cwd: home, env: { HOME: home }, json: true, loadRuntime })
  expect(result.failed).toBe(false)
  return JSON.parse(result.output)
}

describe("omo doctor --models", () => {
  test("#given an Anthropic login and an artistry override plus an exclude list #when --json is asked #then the chain, sources and exclusion come from the resolver", async () => {
    // when
    const report = await view({ categories: { artistry: { model: "anthropic/claude-opus-5-5" } }, exclude_models: ["claude-fable-*"] })
    const artistry = report.categories.find((entry: { name: string }) => entry.name === "artistry")

    // then
    expect(report.excludeModels).toEqual(["claude-fable-*"])
    expect(artistry.primary).toBe("anthropic/claude-opus-5-5")
    expect(artistry.rungs[0]).toEqual({ model: "anthropic/claude-opus-5-5", source: "omo.json", state: "primary" })
    expect(artistry.rungs[1]).toMatchObject({ model: "anthropic/claude-fable-5-1", state: "excluded", excludedBy: "claude-fable-*" })
    expect(report.modelProfile.selection).toBe("default")
    expect(report.modelProfile.applied).toBe("anthropic/claude-opus-5-5")
  })

  test("#given the same config #when the text report is asked #then the excluded rung and its entry are printed", async () => {
    // given
    const { home, agentDir } = sandbox({ exclude_models: ["claude-fable-*"] })

    // when
    const result = await doctorModelChains({ agentDir, cwd: home, env: { HOME: home }, json: false, loadRuntime })

    // then
    const lines = result.output.split("\n")
    expect(lines).toContain("exclude_models: claude-fable-*")
    expect(lines.some((line) => /anthropic\/claude-fable-5-1\s+built-in\s+excluded by exclude_models "claude-fable-\*"/.test(line))).toBe(true)
  })

  test("#given a runtime that cannot load #when asked #then the command fails instead of printing nothing", async () => {
    // when
    const result = await doctorModelChains({ agentDir: "/nonexistent", json: false, loadRuntime: () => Promise.reject(new Error("runtime missing")) })

    // then
    expect(result).toEqual({ output: "FAIL models: runtime missing", failed: true })
  })

  test("#given an unknown option #when run #then it exits 2 without resolving anything", async () => {
    // when
    const code = await runDoctorModels(["--yaml"], { agentDir: "/nonexistent", loadRuntime: () => Promise.reject(new Error("must not load")) })

    // then
    expect(code).toBe(2)
  })
})
