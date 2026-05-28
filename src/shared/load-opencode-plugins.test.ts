/// <reference path="../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"

type LoadOpencodePluginsModule = {
  loadOpencodePlugins: (directory: string) => string[]
  clearOpencodePluginsCache?: () => void
}

const existsSyncMock = mock((_path: string) => true)
const readFileSyncMock = mock((_path: string, _encoding?: string) => `{
  "plugin": ["plugin-a", "plugin-b"]
}`)

async function importFreshLoadOpencodePluginsModule(): Promise<LoadOpencodePluginsModule> {
  const modulePath = `${new URL("./load-opencode-plugins.ts", import.meta.url).pathname}?test=${Date.now()}-${Math.random()}`
  return import(modulePath)
}

describe("loadOpencodePlugins", () => {
  let originalOpencodeConfigDir: string | undefined

  beforeEach(() => {
    originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    delete process.env.OPENCODE_CONFIG_DIR

    existsSyncMock.mockReset()
    existsSyncMock.mockImplementation((_path: string) => true)
    readFileSyncMock.mockReset()
    readFileSyncMock.mockImplementation((_path: string, _encoding?: string) => `{
  "plugin": ["plugin-a", "plugin-b"]
}`)

    mock.module("node:fs", () => ({
      ...fs,
      existsSync: existsSyncMock,
      readFileSync: readFileSyncMock,
    }))
  })

  afterEach(() => {
    if (originalOpencodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir
    }
    mock.restore()
  })

  describe("#given the same directory is loaded twice", () => {
    describe("#when loading plugins repeatedly", () => {
      it("#then does not call readFileSync on the second load", async () => {
        // given
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const firstResult = loadOpencodePlugins("/some/fake/dir")
        const readCountAfterFirstLoad = readFileSyncMock.mock.calls.length
        const secondResult = loadOpencodePlugins("/some/fake/dir")
        const readCountAfterSecondLoad = readFileSyncMock.mock.calls.length

        // then
        expect(firstResult).toEqual(["plugin-a", "plugin-b"])
        expect(secondResult).toEqual(["plugin-a", "plugin-b"])
        expect(readCountAfterFirstLoad).toBeGreaterThan(0)
        expect(readCountAfterSecondLoad - readCountAfterFirstLoad).toBe(0)
      })
    })
  })

  describe("#given the plugin cache was cleared", () => {
    describe("#when loading the same directory again", () => {
      it("#then re-reads plugin config files from disk", async () => {
        // given
        const { loadOpencodePlugins, clearOpencodePluginsCache } = await importFreshLoadOpencodePluginsModule()

        if (typeof clearOpencodePluginsCache !== "function") {
          throw new Error("clearOpencodePluginsCache export is missing")
        }

        // when
        const firstResult = loadOpencodePlugins("/some/fake/dir")
        const readCountAfterFirstLoad = readFileSyncMock.mock.calls.length
        loadOpencodePlugins("/some/fake/dir")
        const readCountAfterSecondLoad = readFileSyncMock.mock.calls.length
        clearOpencodePluginsCache()
        const thirdResult = loadOpencodePlugins("/some/fake/dir")
        const readCountAfterThirdLoad = readFileSyncMock.mock.calls.length

        // then
        expect(firstResult).toEqual(["plugin-a", "plugin-b"])
        expect(thirdResult).toEqual(["plugin-a", "plugin-b"])
        expect(readCountAfterSecondLoad - readCountAfterFirstLoad).toBe(0)
        expect(readCountAfterThirdLoad - readCountAfterSecondLoad).toBeGreaterThan(0)
      })
    })
  })

  describe("#given OPENCODE_CONFIG_DIR points at an active profile", () => {
    describe("#when loading plugins for the project", () => {
      it("#then includes plugin entries from the profile config directory", async () => {
        // given
        process.env.OPENCODE_CONFIG_DIR = "/tmp/opencode-profile"
        existsSyncMock.mockImplementation((filePath: string) => (
          filePath === "/project/.opencode/opencode.json"
          || filePath === "/tmp/opencode-profile/opencode.json"
        ))
        readFileSyncMock.mockImplementation((filePath: string, _encoding?: string) => {
          if (filePath === "/project/.opencode/opencode.json") {
            return JSON.stringify({ plugin: ["file:///repo/omo/src/index.ts"] })
          }
          if (filePath === "/tmp/opencode-profile/opencode.json") {
            return JSON.stringify({ plugin: ["oh-my-openagent@latest"] })
          }
          return JSON.stringify({})
        })
        const { loadOpencodePlugins } = await importFreshLoadOpencodePluginsModule()

        // when
        const result = loadOpencodePlugins("/project")

        // then
        expect(result).toEqual([
          "file:///repo/omo/src/index.ts",
          "oh-my-openagent@latest",
        ])
      })
    })
  })
})
