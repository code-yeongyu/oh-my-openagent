import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { doctorConfigLines } from "../bin/lib/config-doctor.js"
import { runDoctor } from "../bin/lib/doctor.js"
import { configDoctorLines } from "../config-doctor-runtime"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function homeWithUserConfig(document: string): string {
  const home = mkdtempSync(join(tmpdir(), "omo-doctor-config-"))
  roots.push(home)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(join(home, ".omo", "omo.jsonc"), document)
  return home
}

function captureDoctor(options: Record<string, unknown>): string {
  const originalLog = console.log
  const originalExitCode = process.exitCode
  const output: string[] = []
  console.log = (value?: unknown) => { output.push(String(value)) }
  try {
    runDoctor({ harnesses: [] }, [], { list: () => [], fetchDistTags: () => null, daemonReport: () => [], ...options })
    return output.join("\n")
  } finally {
    console.log = originalLog
    process.exitCode = originalExitCode ?? 0
  }
}

describe("omo doctor config lines", () => {
  test("#given a user omo.jsonc with one invalid value beside a valid one #when the config report runs #then one WARN line names the home-relative file and the dotted key", () => {
    const home = homeWithUserConfig(`{ "task": { "host_engine_policy": "sometimes", "default_concurrency": 3 } }`)

    expect(configDoctorLines({ cwd: home, env: { HOME: home } })).toEqual([
      "WARN config: ~/.omo/omo.jsonc: task.host_engine_policy ignored (invalid value)",
    ])
  })

  test("#given a user omo.jsonc that does not parse #when the config report runs #then the file is reported as not loaded", () => {
    const home = homeWithUserConfig(`{ "task": `)

    expect(configDoctorLines({ cwd: home, env: { HOME: home } })).toEqual([
      "WARN config: ~/.omo/omo.jsonc: not loaded (JSONC parse error)",
    ])
  })

  test("#given the launcher loads the staged runtime #when it resolves #then the launcher returns the runtime's lines unchanged", async () => {
    const home = homeWithUserConfig(`{ "agents": { "oracle": { "model": "openai/gpt-6", "temperature": "hot" } } }`)

    const lines = await doctorConfigLines({ cwd: home, env: { HOME: home }, loadRuntime: async () => ({ configDoctorLines }) })

    expect(lines).toEqual(["WARN config: ~/.omo/omo.jsonc: agents.oracle.temperature ignored (invalid value)"])
  })

  test("#given an agent prompt_append file:// value whose file does not exist #when the config report runs #then one WARN line names the config file, the agent, the value and the reason", () => {
    const home = homeWithUserConfig(`{ "agents": { "explore": { "prompt_append": "file://./missing.md" } } }`)

    expect(configDoctorLines({ cwd: home, env: { HOME: home } })).toEqual([
      `WARN config: ~/.omo/omo.jsonc: agents.explore.prompt_append could not be resolved (file does not exist: ${join(home, "missing.md")}): file://./missing.md`,
    ])
  })

  test("#given an agent prompt_append file:// value that resolves #when the config report runs #then no prompt_append line is reported", () => {
    const home = homeWithUserConfig(`{ "agents": { "explore": { "prompt_append": "file://./append.md" } } }`)
    writeFileSync(join(home, "append.md"), "Review the diff, then report.\n")

    expect(configDoctorLines({ cwd: home, env: { HOME: home } })).toEqual([])
  })

  test("#given the staged runtime cannot be loaded #when the launcher asks for config lines #then doctor says the check was unavailable instead of staying silent", async () => {
    const lines = await doctorConfigLines({ loadRuntime: async () => { throw new Error("missing bundle") } })

    expect(lines).toEqual(["WARN config: diagnostics unavailable: missing bundle"])
  })

  test("#given config lines from the launcher #when doctor prints its report #then every line appears in the output", () => {
    const stdout = captureDoctor({ configDiagnostics: ["WARN config: ~/.omo/omo.jsonc: task.host_engine_policy ignored (invalid value)"] })

    expect(stdout.split("\n")).toContain("WARN config: ~/.omo/omo.jsonc: task.host_engine_policy ignored (invalid value)")
  })
})
