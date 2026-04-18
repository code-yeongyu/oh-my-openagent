import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { join } from "node:path"

describe("detectPluginConfigFile memoization", () => {
  const testDir = join(__dirname, ".test-detect-plugin-memoization")

  afterEach(() => {
    mock.restore()
  })

  test("returns cached result on repeated calls for the same directory", async () => {
    // given
    const existsSync = spyOn(fs, "existsSync").mockImplementation((filePath: fs.PathLike) => {
      return String(filePath).endsWith("oh-my-openagent.jsonc")
    })
    const readdirSync = spyOn(fs, "readdirSync").mockImplementation(() => [])
    spyOn(fs, "readFileSync").mockImplementation(() => "")

    const parserModule = await import(`./jsonc-parser?memoization=${Date.now()}-${Math.random()}`)

    // when
    const firstResult = parserModule.detectPluginConfigFile(testDir)
    const callsAfterFirstResult = existsSync.mock.calls.length
    const secondResult = parserModule.detectPluginConfigFile(testDir)

    // then
    expect(firstResult).toEqual(secondResult)
    expect(existsSync.mock.calls.length).toBe(callsAfterFirstResult)
    expect(readdirSync).toHaveBeenCalledTimes(0)
  })

  test("clears cached result when requested", async () => {
    // given
    const existsSync = spyOn(fs, "existsSync").mockImplementation((filePath: fs.PathLike) => {
      return String(filePath).endsWith("oh-my-openagent.jsonc")
    })
    const readdirSync = spyOn(fs, "readdirSync").mockImplementation(() => [])
    spyOn(fs, "readFileSync").mockImplementation(() => "")

    const parserModule = await import(`./jsonc-parser?memoization=${Date.now()}-${Math.random()}`)

    parserModule.detectPluginConfigFile(testDir)
    parserModule.clearPluginConfigFileDetectionCache()
    const callsAfterClear = existsSync.mock.calls.length

    // when
    parserModule.detectPluginConfigFile(testDir)

    // then
    expect(existsSync.mock.calls.length).toBeGreaterThan(callsAfterClear)
    expect(readdirSync).toHaveBeenCalledTimes(0)
  })
})
