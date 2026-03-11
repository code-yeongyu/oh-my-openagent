import { beforeEach, afterEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs"
import * as dataPath from "../../shared/data-path"
import * as logger from "../../shared/logger"
import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import { runBunInstallWithDetails } from "./bun-install"

describe("runBunInstallWithDetails", () => {
  let getOpenCodeCacheDirSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>
  let spawnWithWindowsHideSpy: ReturnType<typeof spyOn>
  let existsSyncSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    getOpenCodeCacheDirSpy = spyOn(dataPath, "getOpenCodeCacheDir").mockReturnValue("/tmp/opencode-cache")
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
    spawnWithWindowsHideSpy = spyOn(spawnHelpers, "spawnWithWindowsHide").mockReturnValue({
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: () => {},
    } as ReturnType<typeof spawnHelpers.spawnWithWindowsHide>)
    existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)
  })

  afterEach(() => {
    getOpenCodeCacheDirSpy.mockRestore()
    logSpy.mockRestore()
    spawnWithWindowsHideSpy.mockRestore()
    existsSyncSpy.mockRestore()
  })

  it("runs bun install in the OpenCode cache directory", async () => {
    const result = await runBunInstallWithDetails()

    expect(result).toEqual({ success: true })
    expect(getOpenCodeCacheDirSpy).toHaveBeenCalledTimes(1)
    expect(spawnWithWindowsHideSpy).toHaveBeenCalledWith(["bun", "install"], {
      cwd: "/tmp/opencode-cache",
      stdout: "inherit",
      stderr: "inherit",
    })
  })
})
