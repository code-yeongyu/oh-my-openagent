/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import * as spawnHelpers from "../../shared/spawn-with-windows-hide"
import { getPackageNameFromPluginEntry, resolvePluginCacheLocation } from "./plugin-cache-entry"
import { repairPluginCache } from "./plugin-cache-repair"

type CreateProcOptions = {
  exitCode?: number | null
  stdout?: string
  stderr?: string
}

function createProc(options: CreateProcOptions = {}): ReturnType<typeof spawnHelpers.spawnWithWindowsHide> {
  const exitCode = options.exitCode ?? 0

  return {
    exited: Promise.resolve(exitCode),
    exitCode,
    stdout: new Blob([options.stdout ?? ""]).stream(),
    stderr: new Blob([options.stderr ?? ""]).stream(),
    kill: () => {},
  } satisfies ReturnType<typeof spawnHelpers.spawnWithWindowsHide>
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function writeHealthyCache(entry: string, version = "1.2.3"): void {
  const location = resolvePluginCacheLocation(entry)
  const packageName = getPackageNameFromPluginEntry(entry)

  if (!location.cacheDir || !location.cachePackagePath || !location.cacheLockfilePath || !location.installedPackageJsonPath || !packageName) {
    throw new Error(`Could not resolve cache location for ${entry}`)
  }

  writeJson(location.cachePackagePath, {
    name: "opencode-plugin-cache",
    private: true,
    dependencies: {
      [packageName]: version,
    },
  })
  writeJson(location.cacheLockfilePath, { name: "opencode-plugin-cache", lockfileVersion: 3 })
  writeJson(location.installedPackageJsonPath, {
    name: packageName,
    version,
  })
}

describe("repairPluginCache", () => {
  const originalXdgCacheHome = process.env.XDG_CACHE_HOME
  let tempCacheHome = ""
  let spawnWithWindowsHideSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    tempCacheHome = mkdtempSync(join(tmpdir(), "omo-plugin-cache-repair-"))
    process.env.XDG_CACHE_HOME = tempCacheHome
    spawnWithWindowsHideSpy = spyOn(spawnHelpers, "spawnWithWindowsHide")
  })

  afterEach(() => {
    spawnWithWindowsHideSpy.mockRestore()

    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }

    rmSync(tempCacheHome, { recursive: true, force: true })
  })

  it("returns a healthy no-op result when the cache is already complete", async () => {
    //#given
    writeHealthyCache("oh-my-openagent")

    //#when
    const result = await repairPluginCache("oh-my-openagent")

    //#then
    expect(result.success).toBe(true)
    expect(result.status).toBe("healthy")
    expect(result.attempted).toBe(false)
    expect(spawnWithWindowsHideSpy).not.toHaveBeenCalled()
  })

  it("repairs a cache that is missing the package lockfile", async () => {
    //#given
    writeHealthyCache("oh-my-openagent")
    const location = resolvePluginCacheLocation("oh-my-openagent")
    unlinkSync(location.cacheLockfilePath!)
    writeFileSync(join(location.cacheDir!, "stale.txt"), "stale", "utf-8")

    spawnWithWindowsHideSpy.mockImplementation((command, options) => {
      writeHealthyCache("oh-my-openagent")
      return createProc({ stdout: command.join(" ") })
    })

    //#when
    const result = await repairPluginCache("oh-my-openagent")

    //#then
    expect(result.success).toBe(true)
    expect(result.status).toBe("repaired")
    expect(result.attempts[0]?.tool).toBe("npm")
    expect(result.attempts[0]?.verified).toBe(true)
    expect(existsSync(join(location.cacheDir!, "stale.txt"))).toBe(false)
  })

  it("repairs a cache that is missing node_modules", async () => {
    //#given
    writeHealthyCache("oh-my-openagent")
    rmSync(join(resolvePluginCacheLocation("oh-my-openagent").cacheDir!, "node_modules"), { recursive: true, force: true })

    spawnWithWindowsHideSpy.mockImplementation((_command, _options) => {
      writeHealthyCache("oh-my-openagent")
      return createProc()
    })

    //#when
    const result = await repairPluginCache("oh-my-openagent")

    //#then
    expect(result.success).toBe(true)
    expect(result.status).toBe("repaired")
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]?.tool).toBe("npm")
  })

  it("falls back to bun when npm is unavailable", async () => {
    //#given
    spawnWithWindowsHideSpy.mockImplementation((command, _options) => {
      if (command[0] === "npm") {
        throw new Error("npm not found")
      }

      writeHealthyCache("oh-my-openagent@latest")
      return createProc()
    })

    //#when
    const result = await repairPluginCache("oh-my-openagent@latest")

    //#then
    expect(result.success).toBe(true)
    expect(result.status).toBe("repaired")
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]?.tool).toBe("npm")
    expect(result.attempts[0]?.error).toContain("npm not found")
    expect(result.attempts[1]?.tool).toBe("bun")
    expect(result.attempts[1]?.verified).toBe(true)
  })

  it("returns a clear failure when both npm and bun are unavailable", async () => {
    //#given
    spawnWithWindowsHideSpy.mockImplementation((command, _options) => {
      throw new Error(`${command[0]} not found`)
    })

    //#when
    const result = await repairPluginCache("oh-my-openagent")

    //#then
    expect(result.success).toBe(false)
    expect(result.status).toBe("failed")
    expect(result.attempts).toHaveLength(2)
    expect(result.error).toContain("bun not found")
  })

  it("skips local file plugin entries", async () => {
    //#given
    const entry = "file:///tmp/oh-my-openagent"

    //#when
    const result = await repairPluginCache(entry)

    //#then
    expect(result.success).toBe(true)
    expect(result.status).toBe("skipped")
    expect(result.attempted).toBe(false)
    expect(spawnWithWindowsHideSpy).not.toHaveBeenCalled()
  })
})
