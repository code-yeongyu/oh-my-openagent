import { describe, expect, it } from "bun:test"
import { readFileSync, realpathSync } from "node:fs"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { __testInternals, createUlwLoopComponent } from "./index"
import {
  activeStatus,
  createLogger,
  createTempOmoBin,
  readRealCwd,
  readRunnerRuntime,
  withEnv,
  withEnvAsync,
} from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop runtime", () => {
  it("#given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored", () => {
    withEnv({ OMO_BIN: "/custom/omo", PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo")
    })
  })

  it("#given omo exists only in a controlled PATH #when resolving the default binary #then it scans PATH without shelling out to Bun", () => {
    const fake = createTempOmoBin()
    try {
      withEnv({ OMO_BIN: undefined, PATH: fake.dir }, () => {
        expect(__testInternals.resolveOmoBin()).toBe(fake.bin)
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given a temp omo binary #when default runOmoCommand executes status #then it captures stdout and cwd via Node-compatible spawning", async () => {
    const fake = createTempOmoBin(activeStatus("NODE-RUNNER"))
    try {
      const result = await __testInternals.runOmoCommand(fake.bin, ["ulw-loop", "status", "--json"], { cwd: fake.dir })

      expect(result).toEqual({ code: 0, stdout: `${activeStatus("NODE-RUNNER")}\n` })
      expect(readRealCwd(fake.dir)).toBe(realpathSync(fake.dir))
      expect(readRunnerRuntime(fake.dir).bunVersion).toBeNull()
    } finally {
      fake.cleanup()
    }
  }, { timeout: 20000 })

  it("#given env and PATH are controlled #when the component registers with defaults #then no Bun global is required for active status handling", async () => {
    const fake = createTempOmoBin(activeStatus("DEFAULT-REGISTRATION"))
    try {
      await withEnvAsync({ OMO_BIN: undefined, PATH: fake.dir }, async () => {
        const pi = new FakeExtensionAPI()
        await createUlwLoopComponent().register(pi, {
          logger: createLogger(),
          config: { getFlag: () => false },
        })

        const results = await pi.dispatch(
          "input",
          { type: "input", text: "continue", source: "interactive" },
          { cwd: fake.dir },
        )

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ action: "transform" })
      })
    } finally {
      fake.cleanup()
    }
  }, { timeout: 20000 })

  it("#given built Senpi runs under Node #when inspecting runtime source #then the ulw-loop component has no Bun global dependency", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

    expect(source).not.toMatch(/\bBun\b/)
  })
})
