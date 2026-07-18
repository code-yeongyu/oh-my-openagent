/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
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
  let originalXdgConfigHome: string | undefined

  function createTempDir(prefix: string): string {
    const directory = mkdtempSync(join(os.tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  beforeEach(() => {
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME

    delete process.env.OPENCODE_CONFIG_DIR
    process.env.XDG_CONFIG_HOME = createTempDir("omo-load-opencode-xdg-home-")
  })

  afterEach(() => {
    if (originalOpencodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    }
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
        const initialPlugins = [
          `file://${join(projectDirectory, "plugin-a.ts")}`,
          `file://${join(projectDirectory, "plugin-b.ts")}`,
        ]
        const updatedPlugin = `file://${join(projectDirectory, "plugin-c.ts")}`
        writeOpencodeConfig(projectDirectory, initialPlugins)
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const firstResult = loadOpencodePlugins(projectDirectory)
        writeOpencodeConfig(projectDirectory, [updatedPlugin])
        const secondResult = loadOpencodePlugins(projectDirectory)

        // then
        expect(firstResult).toContain(initialPlugins[0])
        expect(firstResult).toContain(initialPlugins[1])
        expect(firstResult).not.toContain(updatedPlugin)
        expect(secondResult).toContain(initialPlugins[0])
        expect(secondResult).toContain(initialPlugins[1])
        expect(secondResult).not.toContain(updatedPlugin)
      })
    })
  })

  describe("#given the plugin cache was cleared", () => {
    describe("#when loading the same directory again", () => {
      it("#then re-reads plugin config files from disk", async () => {
        // given
        const projectDirectory = createTempDir("omo-load-opencode-project-")
        const initialPlugins = [
          `file://${join(projectDirectory, "plugin-a.ts")}`,
          `file://${join(projectDirectory, "plugin-b.ts")}`,
        ]
        const updatedPlugin = `file://${join(projectDirectory, "plugin-c.ts")}`
        writeOpencodeConfig(projectDirectory, initialPlugins)
        const { loadOpencodePlugins, clearOpencodePluginsCache } = await importFreshLoadOpencodePluginsModule()

        if (typeof clearOpencodePluginsCache !== "function") {
          throw new Error("clearOpencodePluginsCache export is missing")
        }

        // when
        const firstResult = loadOpencodePlugins(projectDirectory)
        writeOpencodeConfig(projectDirectory, [updatedPlugin])
        const secondResult = loadOpencodePlugins(projectDirectory)
        clearOpencodePluginsCache()
        const thirdResult = loadOpencodePlugins(projectDirectory)

        // then
        expect(firstResult).toContain(initialPlugins[0])
        expect(firstResult).toContain(initialPlugins[1])
        expect(firstResult).not.toContain(updatedPlugin)
        expect(secondResult).toContain(initialPlugins[0])
        expect(secondResult).toContain(initialPlugins[1])
        expect(secondResult).not.toContain(updatedPlugin)
        expect(thirdResult).toContain(updatedPlugin)
        expect(thirdResult).not.toContain(initialPlugins[0])
        expect(thirdResult).not.toContain(initialPlugins[1])
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
        const projectPlugin = `file://${join(projectDirectory, "src", "index.ts")}`
        const profilePlugin = `file://${join(profileDirectory, "profile-plugin.ts")}`
        writeOpencodeConfig(projectDirectory, [projectPlugin])
        writeProfileConfig(profileDirectory, [profilePlugin])
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const result = loadOpencodePlugins(projectDirectory)

        // then
        expect(result).toContain(projectPlugin)
        expect(result).toContain(profilePlugin)
        expect(result.indexOf(projectPlugin)).toBeLessThan(result.indexOf(profilePlugin))
      })
    })
  })

  describe("#given XDG_CONFIG_HOME is set", () => {
    describe("#when loading plugins for the project", () => {
      it("#then discovers plugins from the XDG config directory (not just hardcoded ~/.config)", async () => {
        // given
        const projectDirectory = createTempDir("omo-load-opencode-project-")
        const xdgHomeDirectory = createTempDir("omo-load-opencode-xdg-")
        const xdgOpencodeDir = join(xdgHomeDirectory, "opencode")
        mkdirSync(xdgOpencodeDir, { recursive: true })

        process.env.XDG_CONFIG_HOME = xdgHomeDirectory
        delete process.env.OPENCODE_CONFIG_DIR

        const projectPlugin = `file://${join(projectDirectory, "src", "index.ts")}`
        const xdgPlugin = `file://${join(xdgOpencodeDir, "xdg-plugin.ts")}`
        writeOpencodeConfig(projectDirectory, [projectPlugin])
        writeFileSync(join(xdgOpencodeDir, "opencode.json"), JSON.stringify({ plugin: [xdgPlugin] }))

        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const result = loadOpencodePlugins(projectDirectory)

        // then
        expect(result).toContain(projectPlugin)
        expect(result).toContain(xdgPlugin)
      })
    })
  })
})
