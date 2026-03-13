import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { PACKAGE_NAME } from "../constants"

const systemLoadedVersionModulePath = "./system-loaded-version?system-loaded-version-test"

const { getLoadedPluginVersion, getSuggestedInstallTag }: typeof import("./system-loaded-version") =
  await import(systemLoadedVersionModulePath)

const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
const originalXdgCacheHome = process.env.XDG_CACHE_HOME
const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeJson(filePath: string, value: Record<string, string | Record<string, string>>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value), "utf-8")
}

afterEach(() => {
  if (originalOpencodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
  }

  if (originalXdgCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME
  } else {
    process.env.XDG_CACHE_HOME = originalXdgCacheHome
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("system loaded version", () => {
  describe("getLoadedPluginVersion", () => {
    it("prefers the config directory when both installs exist", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")
      const cacheDir = join(cacheHome, "opencode")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      writeJson(join(configDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "1.2.3" },
      })
      writeJson(join(configDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "1.2.3",
      })
      writeJson(join(cacheDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "9.9.9" },
      })
      writeJson(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "9.9.9",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.cacheDir).toBe(configDir)
      expect(loadedVersion.cachePackagePath).toBe(join(configDir, "package.json"))
      expect(loadedVersion.installedPackagePath).toBe(join(configDir, "node_modules", PACKAGE_NAME, "package.json"))
      expect(loadedVersion.expectedVersion).toBe("1.2.3")
      expect(loadedVersion.loadedVersion).toBe("1.2.3")
    })

    it("falls back to the cache directory for legacy installs", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")
      const cacheDir = join(cacheHome, "opencode")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      writeJson(join(cacheDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "2.3.4" },
      })
      writeJson(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "2.3.4",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.cacheDir).toBe(cacheDir)
      expect(loadedVersion.cachePackagePath).toBe(join(cacheDir, "package.json"))
      expect(loadedVersion.installedPackagePath).toBe(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json"))
      expect(loadedVersion.expectedVersion).toBe("2.3.4")
      expect(loadedVersion.loadedVersion).toBe("2.3.4")
    })
  })

  describe("getSuggestedInstallTag", () => {
    it("returns prerelease channel when current version is prerelease", () => {
      //#given
      const currentVersion = "3.2.0-beta.4"

      //#when
      const installTag = getSuggestedInstallTag(currentVersion)

      //#then
      expect(installTag).toBe("beta")
    })
  })
})
