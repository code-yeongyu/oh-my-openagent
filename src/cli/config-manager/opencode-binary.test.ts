/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as configContext from "./config-context"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"

type OpenCodeBinaryModule = typeof import("./opencode-binary")

type CreateProcOptions = {
  exitCode?: number | null
  output?: { stdout?: string; stderr?: string }
}

function createProc(options: CreateProcOptions = {}): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
  const exitCode = options.exitCode ?? 0
  return {
    exited: Promise.resolve(exitCode),
    exitCode,
    stdout: options.output?.stdout !== undefined ? new Blob([options.output.stdout]).stream() : undefined,
    stderr: options.output?.stderr !== undefined ? new Blob([options.output.stderr]).stream() : undefined,
    kill: () => {},
  } satisfies ReturnType<typeof spawnHelpers.spawnWithWindowsHide>
}

describe("getOpenCodeVersion (installer)", () => {
  let spawnSpy: ReturnType<typeof spyOn>
  let initConfigContextSpy: ReturnType<typeof spyOn>
  let getOpenCodeVersion: OpenCodeBinaryModule["getOpenCodeVersion"]

  beforeEach(async () => {
    spawnSpy = spyOn(spawnHelpers, "spawnWithWindowsHide")
    initConfigContextSpy = spyOn(configContext, "initConfigContext").mockImplementation(() => {})
    const mod = await import(`./opencode-binary?test=${Date.now()}-${Math.random()}`)
    getOpenCodeVersion = mod.getOpenCodeVersion
  })

  afterEach(() => {
    spawnSpy.mockRestore()
    initConfigContextSpy.mockRestore()
  })

  describe("#given clean opencode --version stdout #when getOpenCodeVersion #then returns the semver string", () => {
    it("plain semver", async () => {
      spawnSpy.mockReturnValue(createProc({ output: { stdout: "1.14.33\n" } }))

      const result = await getOpenCodeVersion()

      expect(result).toBe("1.14.33")
    })
  })

  describe("#given Electron-polluted opencode --version stdout #when getOpenCodeVersion #then returns extracted semver, not the timestamp-prefixed line", () => {
    it("regression for #3765 installer caller", async () => {
      const polluted = "00:24:25.202 > app starting { version: '1.14.33', packaged: true }"
      spawnSpy.mockReturnValue(createProc({ output: { stdout: polluted } }))

      const result = await getOpenCodeVersion()

      expect(result).toBe("1.14.33")
    })
  })

  describe("#given non-semver-shaped stdout #when getOpenCodeVersion #then falls back to trimmed output", () => {
    it("preserves legacy behavior for unrecognized formats", async () => {
      spawnSpy.mockReturnValue(createProc({ output: { stdout: "  custom-build\n" } }))

      const result = await getOpenCodeVersion()

      expect(result).toBe("custom-build")
    })
  })

  describe("#given no opencode binary on PATH #when getOpenCodeVersion #then returns null", () => {
    it("all candidate spawns throw", async () => {
      spawnSpy.mockImplementation(() => {
        throw new Error("ENOENT")
      })

      const result = await getOpenCodeVersion()

      expect(result).toBe(null)
    })
  })
})
