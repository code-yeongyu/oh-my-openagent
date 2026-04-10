/// <reference types="bun-types" />

import * as fs from "node:fs"

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as dataPath from "../../shared/data-path"
import * as logger from "../../shared/logger"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import type { BunInstallResult } from "./bun-install"

type BunInstallModule = typeof import("./bun-install")

type CreateProcOptions = {
  exitCode?: number | null
  exited?: Promise<number>
  kill?: () => void
  output?: {
    stdout?: string
    stderr?: string
  }
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

describe("runBunInstallWithDetails", () => {
  let getOpenCodeCacheDirSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>
  let spawnWithWindowsHideSpy: ReturnType<typeof spyOn>
  let existsSyncSpy: ReturnType<typeof spyOn>
  let runBunInstallWithDetails: BunInstallModule["runBunInstallWithDetails"]

  beforeEach(async () => {
    getOpenCodeCacheDirSpy = spyOn(dataPath, "getOpenCodeCacheDir").mockReturnValue("/tmp/opencode-cache")
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
    spawnWithWindowsHideSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(createProc())
    existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

    const bunInstallModule = await import(`./bun-install?test=${Date.now()}-${Math.random()}`)
    runBunInstallWithDetails = bunInstallModule.runBunInstallWithDetails
  })

  afterEach(() => {
    getOpenCodeCacheDirSpy.mockRestore()
    logSpy.mockRestore()
    spawnWithWindowsHideSpy.mockRestore()
    existsSyncSpy.mockRestore()
  })

  describe("#given the cache workspace exists", () => {
    describe("#when bun install uses default piped output", () => {
      it("#then pipes stdout and stderr by default", async () => {
        // given

        // when
        const result = await runBunInstallWithDetails()

        // then
        expect(result).toEqual({ success: true })
        expect(getOpenCodeCacheDirSpy).toHaveBeenCalledTimes(1)
        expect(spawnWithWindowsHideSpy).toHaveBeenCalledWith(["bun", "install"], {
          cwd: "/tmp/opencode-cache/packages",
          stdout: "pipe",
          stderr: "pipe",
        })
      })
    })

    describe("#when bun install uses piped output", () => {
      it("#then passes pipe mode to the spawned process", async () => {
        // given

        // when
        const result = await runBunInstallWithDetails({ outputMode: "pipe" })

        // then
        expect(result).toEqual({ success: true })
        expect(spawnWithWindowsHideSpy).toHaveBeenCalledWith(["bun", "install"], {
          cwd: "/tmp/opencode-cache/packages",
          stdout: "pipe",
          stderr: "pipe",
        })
      })
    })

    describe("#when bun install uses explicit inherited output", () => {
      it("#then passes inherit mode to the spawned process", async () => {
        // given

        // when
        const result = await runBunInstallWithDetails({ outputMode: "inherit" })

        // then
        expect(result).toEqual({ success: true })
        expect(spawnWithWindowsHideSpy).toHaveBeenCalledWith(["bun", "install"], {
          cwd: "/tmp/opencode-cache/packages",
          stdout: "inherit",
          stderr: "inherit",
        })
      })
    })

    describe("#when piped bun install fails", () => {
      it("#then logs captured stdout and stderr", async () => {
        // given
        spawnWithWindowsHideSpy.mockReturnValue(
          createProc({
            exitCode: 1,
            output: {
              stdout: "resolved 10 packages",
              stderr: "network error",
            },
          })
        )

        // when
        const result = await runBunInstallWithDetails({ outputMode: "pipe" })

        // then
        expect(result).toEqual({
          success: false,
          error: "bun install failed with exit code 1",
        })
        expect(logSpy).toHaveBeenCalledWith("[bun-install] Captured output from failed bun install", {
          stdout: "resolved 10 packages",
          stderr: "network error",
        })
      })
    })

    describe("#when the install times out and proc.exited never resolves", () => {
      it("#then returns timedOut true without hanging", async () => {
        // given
        let killCallCount = 0
        const originalSetTimeout = globalThis.setTimeout
        const originalClearTimeout = globalThis.clearTimeout

        Object.defineProperty(globalThis, "setTimeout", {
          configurable: true,
          value: Object.assign(
            (callback: TimerHandler) => {
              if (typeof callback === "function") {
                callback()
              }

              return 0
            },
            {
              __promisify__: originalSetTimeout.__promisify__,
            }
          ),
        })
        Object.defineProperty(globalThis, "clearTimeout", {
          configurable: true,
          value: () => undefined,
        })

        spawnWithWindowsHideSpy.mockReturnValue(
          createProc({
            exitCode: null,
            exited: new Promise<number>(() => {}),
            kill: () => {
              killCallCount += 1
            },
          })
        )
        const timeoutAwareModule = await import(`./bun-install?timeout-test=${Date.now()}-${Math.random()}`)

        try {
          // when
          const outcome = await timeoutAwareModule.runBunInstallWithDetails({ outputMode: "pipe" })

          // then
          expect(outcome).toEqual({
            success: false,
            timedOut: true,
            error: 'bun install timed out after 60 seconds. Try running manually: cd "/tmp/opencode-cache/packages" && bun i',
          } satisfies BunInstallResult)
          expect(killCallCount).toBe(1)
        } finally {
          Object.defineProperty(globalThis, "setTimeout", {
            configurable: true,
            value: originalSetTimeout,
          })
          Object.defineProperty(globalThis, "clearTimeout", {
            configurable: true,
            value: originalClearTimeout,
          })
        }
      })
    })
  })
})
