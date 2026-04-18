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
  beforeEach(() => {
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
})
