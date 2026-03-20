/// <reference types="bun-types" />

import * as fs from "node:fs"

import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from "bun:test"

import * as dataPath from "../../shared/data-path"
import * as logger from "../../shared/logger"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import type { BunInstallResult } from "./bun-install"
import { runBunInstallWithDetails } from "./bun-install"

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

  beforeEach(() => {
    getOpenCodeCacheDirSpy = spyOn(dataPath, "getOpenCodeCacheDir").mockReturnValue("/tmp/opencode-cache")
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
    spawnWithWindowsHideSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(createProc())
    existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)
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
          cwd: "/tmp/opencode-cache",
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
          cwd: "/tmp/opencode-cache",
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
          cwd: "/tmp/opencode-cache",
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
        jest.useFakeTimers()

        let killCallCount = 0
        spawnWithWindowsHideSpy.mockReturnValue(
          createProc({
            exitCode: null,
            exited: new Promise<number>(() => {}),
            kill: () => {
              killCallCount += 1
            },
          })
        )

        try {
          // when
          const resultPromise = runBunInstallWithDetails({ outputMode: "pipe" })
          jest.advanceTimersByTime(60_000)
          jest.runOnlyPendingTimers()
          await Promise.resolve()

          const outcome = await Promise.race([
            resultPromise.then((result) => ({
              status: "resolved" as const,
              result,
            })),
            new Promise<{ status: "pending" }>((resolve) => {
              queueMicrotask(() => resolve({ status: "pending" }))
            }),
          ])

          // then
          if (outcome.status === "pending") {
            throw new Error("runBunInstallWithDetails did not resolve after timing out")
          }

          expect(outcome.result).toEqual({
            success: false,
            timedOut: true,
            error: 'bun install timed out after 60 seconds. Try running manually: cd "/tmp/opencode-cache" && bun i',
          } satisfies BunInstallResult)
          expect(killCallCount).toBe(1)
        } finally {
          jest.clearAllTimers()
          jest.useRealTimers()
        }
      })
    })
  })
})
