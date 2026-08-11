import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { __testInternals, createUlwLoopComponent } from "./index"
import {
  activeStatus,
  createLogger,
  createTempOmoBin,
  createTempStderrFloodScript,
  readRealCwd,
  readRunnerArgv,
  readRunnerRuntime,
  withEnv,
  withEnvAsync,
} from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop runtime", () => {
  it("#given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored", () => {
    withEnv({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: "/custom/omo", PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo")
    })
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

  it("#given a child flooding stderr beyond the 64KiB pipe buffer #when runOmoCommand executes a .js target #then it completes within the 30s budget via process.execPath", async () => {
    const flood = createTempStderrFloodScript(128 * 1024, activeStatus("FLOOD"))
    try {
      const startedAt = Date.now()
      const result = await __testInternals.runOmoCommand(flood.script, ["ulw-loop", "status", "--json"], {
        cwd: flood.dir,
      })

      expect(Date.now() - startedAt).toBeLessThan(30_000)
      expect(result).toEqual({ code: 0, stdout: `${activeStatus("FLOOD")}\n` })
    } finally {
      flood.cleanup()
    }
  }, { timeout: 20000 })

  it("#given built Senpi runs under Node #when inspecting runtime source #then the ulw-loop component has no Bun global dependency", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")

    expect(source).not.toMatch(/\bBun\b/)
  })
})

describe("omo-senpi ulw-loop resolveOmoBin toolkit-first chain", () => {
  it("#given only OMO_AGENT_TOOLKIT_BIN is set #when resolving #then it wins and PATH is ignored", () => {
    withEnv({ OMO_AGENT_TOOLKIT_BIN: "/custom/omo-agent-toolkit", OMO_BIN: undefined, PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo-agent-toolkit")
    })
  })

  it("#given all three links are present #when resolving #then OMO_AGENT_TOOLKIT_BIN beats the PATH toolkit and OMO_BIN", () => {
    const fake = createTempOmoBin(activeStatus(), "omo-agent-toolkit")
    try {
      withEnv({ OMO_AGENT_TOOLKIT_BIN: "/custom/toolkit", OMO_BIN: "/custom/omo", PATH: fake.dir }, () => {
        expect(__testInternals.resolveOmoBin()).toBe("/custom/toolkit")
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given a PATH toolkit and OMO_BIN #when resolving #then the PATH omo-agent-toolkit wins over OMO_BIN", () => {
    const fake = createTempOmoBin(activeStatus(), "omo-agent-toolkit")
    try {
      withEnv({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: "/custom/omo", PATH: fake.dir }, () => {
        expect(__testInternals.resolveOmoBin()).toBe(fake.bin)
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given only OMO_BIN is set #when resolving #then it resolves exactly as before the rename (characterization)", () => {
    withEnv({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: "/custom/omo", PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo")
    })
  })

  it("#given PATH holds only a fake named omo #when resolving #then it returns null - the bare-omo PATH tail is deliberately dropped", () => {
    const fake = createTempOmoBin()
    try {
      withEnv({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: undefined, PATH: fake.dir }, () => {
        expect(__testInternals.resolveOmoBin()).toBeNull()
      })
    } finally {
      fake.cleanup()
    }
  })

  it("#given a whitespace-only OMO_AGENT_TOOLKIT_BIN #when resolving #then it falls through to OMO_BIN", () => {
    withEnv({ OMO_AGENT_TOOLKIT_BIN: "   ", OMO_BIN: "/custom/omo", PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBe("/custom/omo")
    })
  })

  it("#given nothing is set and PATH is empty #when resolving #then it returns null", () => {
    withEnv({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: undefined, PATH: "" }, () => {
      expect(__testInternals.resolveOmoBin()).toBeNull()
    })
  })
})

describe("omo-senpi ulw-loop default registration through the toolkit chain", () => {
  it("#given a PATH omo-agent-toolkit and no envs #when the component registers with defaults #then the toolkit binary receives the status argv", async () => {
    const fake = createTempOmoBin(activeStatus("DEFAULT-REGISTRATION"), "omo-agent-toolkit")
    try {
      await withEnvAsync({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: undefined, PATH: fake.dir }, async () => {
        const pi = new FakeExtensionAPI()
        await createUlwLoopComponent().register(pi, {
          logger: createLogger(),
          config: { getFlag: () => false },
        })

        const results = await pi.dispatch(
          "input",
          { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
          { cwd: fake.dir },
        )

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ action: "transform" })
        expect(readRunnerArgv(fake.dir)).toEqual(["ulw-loop", "status", "--json"])
      })
    } finally {
      fake.cleanup()
    }
  }, { timeout: 20000 })

  it("#given PATH holds only a fake named omo and no envs #when the component registers with defaults #then it degrades without executing the stale binary", async () => {
    const fake = createTempOmoBin(activeStatus("STALE-OMO"))
    try {
      await withEnvAsync({ OMO_AGENT_TOOLKIT_BIN: undefined, OMO_BIN: undefined, PATH: fake.dir }, async () => {
        const pi = new FakeExtensionAPI()
        const logger = createLogger()
        await createUlwLoopComponent().register(pi, {
          logger,
          config: { getFlag: () => false },
        })

        const results = await pi.dispatch(
          "input",
          { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
          { cwd: fake.dir },
        )

        expect(results).toEqual([{ action: "continue" }])
        expect(logger.entries).toContainEqual({
          level: "info",
          message: "omo-senpi ulw-loop inactive; omo binary not found",
        })
        expect(existsSync(join(fake.dir, "argv.json"))).toBe(false)
      })
    } finally {
      fake.cleanup()
    }
  }, { timeout: 20000 })
})
