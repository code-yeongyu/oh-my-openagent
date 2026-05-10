/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as configContext from "./config-context"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"

type OpenCodeBinaryModule = typeof import("./opencode-binary")

type CreateProcOptions = {
  exitCode?: number | null
  exited?: Promise<number>
  output?: { stdout?: string; stderr?: string }
  kill?: (signal?: NodeJS.Signals) => void
}

function createProc(options: CreateProcOptions = {}): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
  const exitCode = options.exitCode ?? 0
  return {
    exited: options.exited ?? Promise.resolve(exitCode),
    exitCode,
    stdout: options.output?.stdout !== undefined ? new Blob([options.output.stdout]).stream() : undefined,
    stderr: options.output?.stderr !== undefined ? new Blob([options.output.stderr]).stream() : undefined,
    kill: options.kill ?? (() => {}),
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

  describe("#given timeout path #when getOpenCodeVersion #then sends SIGTERM and SIGKILL and returns null without hanging", () => {
    it("bounds process lifetime on hung --version", async () => {
      const killCalls: Array<NodeJS.Signals | undefined> = []
      spawnSpy.mockReturnValue(
        createProc({
          exited: new Promise<number>(() => {}),
          output: { stdout: "" },
          kill: (signal?: NodeJS.Signals) => {
            killCalls.push(signal)
          },
        }),
      )

      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler()
        }
        return 1 as unknown as ReturnType<typeof setTimeout>
      })

      const result = await getOpenCodeVersion()

      expect(result).toBe(null)
      expect(killCalls).toEqual(["SIGTERM", "SIGKILL", "SIGTERM", "SIGKILL"])

      setTimeoutSpy.mockRestore()
    })
  })

  describe("#given quick successful exit #when getOpenCodeVersion #then clears the watchdog timer", () => {
    it("avoids timer leak after success", async () => {
      spawnSpy.mockReturnValue(createProc({ output: { stdout: "1.14.33\n" } }))

      const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")

      const result = await getOpenCodeVersion()

      expect(result).toBe("1.14.33")
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)

      clearTimeoutSpy.mockRestore()
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
