/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

type LoadOpencodePluginsModule = {
  loadOpencodePlugins: (directory: string) => string[]
  clearOpencodePluginsCache?: () => void
}

async function importFreshLoadOpencodePluginsModule(): Promise<LoadOpencodePluginsModule> {
  const modulePath = `${fileURLToPath(new URL("./load-opencode-plugins.ts", import.meta.url))}?test=${Date.now()}-${Math.random()}`
  return import(modulePath)
}

function writeOpencodeConfig(directory: string, pluginEntries: readonly string[]): void {
  const configDirectory = join(directory, ".opencode")
  mkdirSync(configDirectory, { recursive: true })
  writeFileSync(join(configDirectory, "opencode.json"), JSON.stringify({ plugin: pluginEntries }))
}

function writeProfileConfig(directory: string, pluginEntries: readonly string[]): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugin: pluginEntries }))
}

describe("loadOpencodePlugins", () => {
  const tempDirs: string[] = []
  let originalOpencodeConfigDir: string | undefined
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalAppdata: string | undefined

  function createTempDir(prefix: string): string {
    const directory = mkdtempSync(join(os.tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  beforeEach(() => {
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalAppdata = process.env.APPDATA

    delete process.env.OPENCODE_CONFIG_DIR
    const homeDirectory = createTempDir("omo-load-opencode-home-")
    process.env.HOME = homeDirectory
    process.env.USERPROFILE = homeDirectory
    delete process.env.APPDATA
    mock.module("node:os", () => ({
      ...os,
      homedir: () => homeDirectory,
    }))
  })

  afterEach(() => {
    if (originalOpencodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    }
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }
    if (originalAppdata === undefined) {
      delete process.env.APPDATA
    } else {
      process.env.APPDATA = originalAppdata
    }
    mock.restore()
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()
      if (directory) {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  })

  describe("#given the same directory is loaded twice", () => {
    describe("#when loading plugins repeatedly", () => {
      it("#then returns the cached plugin entries on the second load", async () => {
        // given
        const projectDirectory = createTempDir("omo-load-opencode-project-")
        writeOpencodeConfig(projectDirectory, ["plugin-a", "plugin-b"])
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const firstResult = loadOpencodePlugins(projectDirectory)
        writeOpencodeConfig(projectDirectory, ["plugin-c"])
        const secondResult = loadOpencodePlugins(projectDirectory)

        // then
        expect(firstResult).toEqual(["plugin-a", "plugin-b"])
        expect(secondResult).toEqual(["plugin-a", "plugin-b"])
      })
    })
  })

  describe("#given the plugin cache was cleared", () => {
    describe("#when loading the same directory again", () => {
      it("#then re-reads plugin config files from disk", async () => {
        // given
        const projectDirectory = createTempDir("omo-load-opencode-project-")
        writeOpencodeConfig(projectDirectory, ["plugin-a", "plugin-b"])
        const { loadOpencodePlugins, clearOpencodePluginsCache } = await importFreshLoadOpencodePluginsModule()

        if (typeof clearOpencodePluginsCache !== "function") {
          throw new Error("clearOpencodePluginsCache export is missing")
        }

        // when
        const firstResult = loadOpencodePlugins(projectDirectory)
        writeOpencodeConfig(projectDirectory, ["plugin-c"])
        const secondResult = loadOpencodePlugins(projectDirectory)
        clearOpencodePluginsCache()
        const thirdResult = loadOpencodePlugins(projectDirectory)

        // then
        expect(firstResult).toEqual(["plugin-a", "plugin-b"])
        expect(secondResult).toEqual(["plugin-a", "plugin-b"])
        expect(thirdResult).toEqual(["plugin-c"])
      })
    })
  })

  describe("#given OPENCODE_CONFIG_DIR points at an active profile", () => {
    describe("#when loading plugins for the project", () => {
      it("#then includes plugin entries from the profile config directory", async () => {
        // given
        const projectDirectory = createTempDir("omo-load-opencode-project-")
        const profileDirectory = createTempDir("omo-load-opencode-profile-")
        process.env.OPENCODE_CONFIG_DIR = profileDirectory
        writeOpencodeConfig(projectDirectory, ["file:///repo/omo/src/index.ts"])
        writeProfileConfig(profileDirectory, ["oh-my-openagent@latest"])
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const result = loadOpencodePlugins(projectDirectory)

        // then
        expect(result).toEqual([
          "file:///repo/omo/src/index.ts",
          "oh-my-openagent@latest",
        ])
      })
    })
  })
})
