/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as configContext from "./config-context"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type OpenCodeBinaryModule = typeof import("./opencode-binary")

type CreateProcOptions = {
  exitCode?: number | null
  exited?: Promise<number>
  output?: {
    stdout?: string
    stdoutStream?: ReadableStream<Uint8Array>
    stderr?: string
  }
  kill?: (signal?: NodeJS.Signals) => void
}

function createProc(options: CreateProcOptions = {}): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
  const exitCode = options.exitCode ?? 0
  return {
    exited: options.exited ?? Promise.resolve(exitCode),
    exitCode,
    stdout:
      options.output?.stdoutStream ??
      (options.output?.stdout !== undefined ? new Blob([options.output.stdout]).stream() : undefined),
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

      const immediateSetTimeout = unsafeTestValue<typeof globalThis.setTimeout>(((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler()
        }
        return unsafeTestValue<ReturnType<typeof setTimeout>>(1)
      }))
      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(immediateSetTimeout)

      const result = await getOpenCodeVersion()

      expect(result).toBe(null)
      expect(killCalls).toEqual(["SIGTERM", "SIGKILL"])

      setTimeoutSpy.mockRestore()
    })
  })

  describe("#given never-closing stdout after kill #when getOpenCodeVersion #then returns within bounded time", () => {
    it("bounds outputPromise wait and returns null", async () => {
      const neverClosingStdout = new ReadableStream<Uint8Array>({
        start() {
          // Intentionally never closing to simulate a hung stdout stream.
        },
      })
      spawnSpy.mockReturnValue(
        createProc({
          exited: new Promise<number>(() => {}),
          output: { stdoutStream: neverClosingStdout },
          kill: () => {},
        }),
      )

      const immediateSetTimeout = unsafeTestValue<typeof globalThis.setTimeout>(((handler: TimerHandler) => {
        if (typeof handler === "function") {
          handler()
        }
        return unsafeTestValue<ReturnType<typeof setTimeout>>(1)
      }))
      const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(immediateSetTimeout)

      const result = await getOpenCodeVersion()

      expect(result).toBe(null)

      setTimeoutSpy.mockRestore()
    })
  })

  describe("#given quick successful exit #when getOpenCodeVersion #then clears active timers", () => {
    it("avoids timer leaks after success", async () => {
      spawnSpy.mockReturnValue(createProc({ output: { stdout: "1.14.33\n" } }))

      const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")

      const result = await getOpenCodeVersion()

      expect(result).toBe("1.14.33")
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)

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

  describe("#given spawn throws a non-Error value #when getOpenCodeVersion #then the value is rethrown", () => {
    it("does not swallow unknown throw values", async () => {
      const unknownFailure = { reason: "ENOENT" } as const
      spawnSpy.mockImplementation(() => {
        throw unknownFailure
      })

      const result = await getOpenCodeVersion().then(
        () => "resolved",
        (error: unknown) => error,
      )

      expect(result).toBe(unknownFailure)
    })
  })
})
