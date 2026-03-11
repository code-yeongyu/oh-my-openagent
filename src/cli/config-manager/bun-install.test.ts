/// <reference types="bun-types" />

import * as fs from "node:fs"

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import * as dataPath from "../../shared/data-path"
import * as logger from "../../shared/logger"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import { runBunInstallWithDetails } from "./bun-install"

function createProc(
  exitCode: number,
  output?: { stdout?: string; stderr?: string }
): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
  return {
    exited: Promise.resolve(exitCode),
    exitCode,
    stdout: output?.stdout !== undefined ? new Blob([output.stdout]).stream() : undefined,
    stderr: output?.stderr !== undefined ? new Blob([output.stderr]).stream() : undefined,
    kill: () => {},
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
    spawnWithWindowsHideSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue(createProc(0))
    existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)
  })

  afterEach(() => {
    getOpenCodeCacheDirSpy.mockRestore()
    logSpy.mockRestore()
    spawnWithWindowsHideSpy.mockRestore()
    existsSyncSpy.mockRestore()
  })

  it("runs bun install in the OpenCode cache directory with inherited output by default", async () => {
    // given

    // when
    const result = await runBunInstallWithDetails()

    // then
    expect(result).toEqual({ success: true })
    expect(getOpenCodeCacheDirSpy).toHaveBeenCalledTimes(1)
    expect(spawnWithWindowsHideSpy).toHaveBeenCalledWith(["bun", "install"], {
      cwd: "/tmp/opencode-cache",
      stdout: "inherit",
      stderr: "inherit",
    })
  })

  it("pipes install output when requested", async () => {
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

  it("logs captured output when piped install fails", async () => {
    // given
    spawnWithWindowsHideSpy.mockReturnValue(
      createProc(1, {
        stdout: "resolved 10 packages",
        stderr: "network error",
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
