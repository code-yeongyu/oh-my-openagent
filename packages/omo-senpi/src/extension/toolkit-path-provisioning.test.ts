/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { createToolkitPathProvisioning } from "./toolkit-path-provisioning"

describe("toolkit path provisioning", () => {
  let fixtureRoot: string
  let originalPath: string | undefined
  let originalToolkitBin: string | undefined

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "omo-toolkit-path-"))
    originalPath = process.env.PATH
    originalToolkitBin = process.env.OMO_AGENT_TOOLKIT_BIN
  })

  afterEach(async () => {
    restoreEnv("PATH", originalPath)
    restoreEnv("OMO_AGENT_TOOLKIT_BIN", originalToolkitBin)
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  describe("#given the toolkit directory exists", () => {
    describe("#when provisioning runs with a bare PATH and no preset toolkit bin", () => {
      it("#then prepends the dir as the leading PATH entry and sets OMO_AGENT_TOOLKIT_BIN to cli.js", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        process.env.PATH = ["/usr/bin", "/bin"].join(delimiter)
        delete process.env.OMO_AGENT_TOOLKIT_BIN

        createToolkitPathProvisioning({ baseDir })()

        expect(process.env.PATH).toBe([baseDir, "/usr/bin", "/bin"].join(delimiter))
        expect(readEnv("OMO_AGENT_TOOLKIT_BIN")).toBe(join(baseDir, "cli.js"))
      })
    })

    describe("#when OMO_AGENT_TOOLKIT_BIN is already set", () => {
      it("#then keeps the preset value and still prepends the toolkit dir to PATH", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        process.env.PATH = "/usr/bin"
        process.env.OMO_AGENT_TOOLKIT_BIN = "/preset/omo-agent-toolkit.js"

        createToolkitPathProvisioning({ baseDir })()

        expect(process.env.OMO_AGENT_TOOLKIT_BIN).toBe("/preset/omo-agent-toolkit.js")
        expect(process.env.PATH).toBe([baseDir, "/usr/bin"].join(delimiter))
      })
    })

    describe("#when OMO_AGENT_TOOLKIT_BIN is set to an empty string", () => {
      it("#then treats it as unset and points it at cli.js", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        process.env.PATH = "/usr/bin"
        process.env.OMO_AGENT_TOOLKIT_BIN = ""

        createToolkitPathProvisioning({ baseDir })()

        expect(process.env.OMO_AGENT_TOOLKIT_BIN).toBe(join(baseDir, "cli.js"))
      })
    })

    describe("#when provisioning runs twice", () => {
      it("#then PATH holds exactly one toolkit entry and it stays leading", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        process.env.PATH = "/usr/bin"
        delete process.env.OMO_AGENT_TOOLKIT_BIN

        const provision = createToolkitPathProvisioning({ baseDir })
        provision()
        provision()

        const entries = (process.env.PATH ?? "").split(delimiter)
        expect(entries[0]).toBe(baseDir)
        expect(entries.filter((entry) => entry === baseDir)).toHaveLength(1)
        expect(process.env.PATH).toBe([baseDir, "/usr/bin"].join(delimiter))
      })
    })
  })

  describe("#given the toolkit directory is absent", () => {
    describe("#when provisioning runs", () => {
      it("#then leaves the environment byte-identical", async () => {
        const baseDir = join(fixtureRoot, "missing-toolkit")
        process.env.PATH = "/usr/bin"
        delete process.env.OMO_AGENT_TOOLKIT_BIN

        createToolkitPathProvisioning({ baseDir })()

        expect(process.env.PATH).toBe("/usr/bin")
        expect(process.env.OMO_AGENT_TOOLKIT_BIN).toBeUndefined()
      })
    })
  })

  // Regression coverage for #6689 - Windows names the inherited variable `Path`
  // (HKCU/HKLM Environment: Path) while JS object keys are case-sensitive. A
  // hardcoded uppercase read yields undefined there and the write creates a
  // SECOND `PATH` key holding only the toolkit dir; later `{ ...process.env }`
  // spawn merges let the truncated entry shadow the inherited full value.
  describe("#given a Windows-style env whose inherited path key is 'Path'", () => {
    describe("#when provisioning prepends the toolkit dir", () => {
      it("#then the full inherited Path survives under its original key and no duplicate uppercase PATH is created", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        const windowsEnv: Record<string, string | undefined> = {
          Path: ["C:\\Windows\\System32", "C:\\Program Files\\nodejs"].join(delimiter),
        }

        createToolkitPathProvisioning({ baseDir, env: windowsEnv })()

        expect(windowsEnv.Path).toBe([baseDir, "C:\\Windows\\System32", "C:\\Program Files\\nodejs"].join(delimiter))
        expect(windowsEnv.PATH).toBeUndefined()
      })
    })
  })

  describe("#given an env that already carries both PATH spellings", () => {
    describe("#when provisioning runs", () => {
      it("#then it prepends onto the first resolved path key without adding a third variant", async () => {
        const baseDir = join(fixtureRoot, "agent-toolkit")
        await mkdir(baseDir, { recursive: true })
        const mixedEnv: Record<string, string | undefined> = {
          PATH: "C:\\truncated",
          Path: "C:\\Windows\\System32",
        }

        createToolkitPathProvisioning({ baseDir, env: mixedEnv })()

        expect(mixedEnv.PATH).toBe([baseDir, "C:\\truncated"].join(delimiter))
        expect(mixedEnv.Path).toBe("C:\\Windows\\System32")
      })
    })
  })
})

// Reads through a function boundary so `delete process.env.X` narrowing does not pin the
// compile-time type to undefined after provisioning mutates the env out of band.
function readEnv(name: string): string | undefined {
  return process.env[name]
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
