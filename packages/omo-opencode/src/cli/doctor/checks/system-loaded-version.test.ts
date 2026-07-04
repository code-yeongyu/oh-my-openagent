import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { PACKAGE_NAME } from "../framework/constants"
import { ACCEPTED_PACKAGE_NAMES, PLUGIN_NAME } from "../../../shared/plugin-identity"
import { resolveSymlink } from "../../../shared/file-utils"

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

function expectedPath(filePath: string): string {
  return resolveSymlink(filePath)
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
      expect(loadedVersion.cacheDir).toBe(expectedPath(configDir))
      expect(loadedVersion.cachePackagePath).toBe(expectedPath(join(configDir, "package.json")))
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(configDir, "node_modules", PACKAGE_NAME, "package.json")))
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
      expect(loadedVersion.cacheDir).toBe(expectedPath(cacheDir))
      expect(loadedVersion.cachePackagePath).toBe(expectedPath(join(cacheDir, "package.json")))
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")))
      expect(loadedVersion.expectedVersion).toBe("2.3.4")
      expect(loadedVersion.loadedVersion).toBe("2.3.4")
    })

    it("detects installs published under the canonical plugin name", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")

      process.env.OPENCODE_CONFIG_DIR = configDir

      writeJson(join(configDir, "package.json"), {
        dependencies: { [PLUGIN_NAME]: "5.6.7" },
      })
      writeJson(join(configDir, "node_modules", PLUGIN_NAME, "package.json"), {
        version: "5.6.7",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(configDir, "node_modules", PLUGIN_NAME, "package.json")))
      expect(loadedVersion.expectedVersion).toBe("5.6.7")
      expect(loadedVersion.loadedVersion).toBe("5.6.7")
    })

    it("detects installs under OpenCode's packages/<name>@<tag> directory", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")
      const cacheDir = join(cacheHome, "opencode")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      const taggedInstallDir = join(cacheDir, "packages", `${PLUGIN_NAME}@latest`)
      writeJson(join(taggedInstallDir, "package.json"), {
        dependencies: { [PLUGIN_NAME]: "8.8.8" },
      })
      writeJson(join(taggedInstallDir, "node_modules", PLUGIN_NAME, "package.json"), {
        version: "8.8.8",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(taggedInstallDir, "node_modules", PLUGIN_NAME, "package.json")))
      expect(loadedVersion.cachePackagePath).toBe(expectedPath(join(taggedInstallDir, "package.json")))
      expect(loadedVersion.expectedVersion).toBe("8.8.8")
      expect(loadedVersion.loadedVersion).toBe("8.8.8")
    })

    it("prefers the flat node_modules install over a packages/<name>@<tag> install in the same root", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")
      const cacheDir = join(cacheHome, "opencode")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      writeJson(join(cacheDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "3.3.3" },
      })
      writeJson(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "3.3.3",
      })
      const taggedInstallDir = join(cacheDir, "packages", `${PLUGIN_NAME}@latest`)
      writeJson(join(taggedInstallDir, "node_modules", PLUGIN_NAME, "package.json"), {
        version: "8.8.8",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")))
      expect(loadedVersion.loadedVersion).toBe("3.3.3")
    })

    it("falls back to require.resolve when neither config nor cache directory has an install", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.loadedVersion).not.toBeNull()
      expect(loadedVersion.loadedVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
      expect(loadedVersion.installedPackagePath).toContain("package.json")
    })

    it("prefers candidate install path over require.resolve fallback when candidate exists", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      writeJson(join(configDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "7.7.7" },
      })
      writeJson(join(configDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "7.7.7",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(join(configDir, "node_modules", PACKAGE_NAME, "package.json")))
      expect(loadedVersion.loadedVersion).toBe("7.7.7")
    })

    it("returns null versions when selected package JSON files are invalid", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")

      process.env.OPENCODE_CONFIG_DIR = configDir

      writeFileSync(join(configDir, "package.json"), "{not json", "utf-8")
      const installedPackagePath = join(configDir, "node_modules", PACKAGE_NAME, "package.json")
      mkdirSync(dirname(installedPackagePath), { recursive: true })
      writeFileSync(installedPackagePath, "{not json", "utf-8")

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.installedPackagePath).toBe(expectedPath(installedPackagePath))
      expect(loadedVersion.expectedVersion).toBeNull()
      expect(loadedVersion.loadedVersion).toBeNull()
    })

    it("#given no config or cache install #when resolving the loaded version #then the resolved manifest path is package.json-shaped and any existing manifest carries an accepted name", () => {
      //#given
      const configDir = createTemporaryDirectory("omo-config-")
      const cacheHome = createTemporaryDirectory("omo-cache-")

      process.env.OPENCODE_CONFIG_DIR = configDir
      process.env.XDG_CACHE_HOME = cacheHome

      //#when
      const info = getLoadedPluginVersion()

      //#then
      expect(info.installedPackagePath.endsWith("package.json")).toBe(true)
      if (existsSync(info.installedPackagePath)) {
        const pkg = JSON.parse(readFileSync(info.installedPackagePath, "utf-8")) as { name?: string }
        expect(ACCEPTED_PACKAGE_NAMES as readonly string[]).toContain(pkg.name)
      }
    })

    it("resolves symlinked config directories before selecting install path", () => {
      //#given
      const realConfigDir = createTemporaryDirectory("omo-real-config-")
      const symlinkBaseDir = createTemporaryDirectory("omo-symlink-base-")
      const symlinkConfigDir = join(symlinkBaseDir, "config-link")

      symlinkSync(realConfigDir, symlinkConfigDir, process.platform === "win32" ? "junction" : "dir")
      process.env.OPENCODE_CONFIG_DIR = symlinkConfigDir

      writeJson(join(realConfigDir, "package.json"), {
        dependencies: { [PACKAGE_NAME]: "4.5.6" },
      })
      writeJson(join(realConfigDir, "node_modules", PACKAGE_NAME, "package.json"), {
        version: "4.5.6",
      })

      //#when
      const loadedVersion = getLoadedPluginVersion()

      //#then
      expect(loadedVersion.cacheDir).toBe(resolveSymlink(symlinkConfigDir))
      expect(loadedVersion.expectedVersion).toBe("4.5.6")
      expect(loadedVersion.loadedVersion).toBe("4.5.6")
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
