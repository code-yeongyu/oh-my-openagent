import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PACKAGE_NAME } from "../constants"
import { getLatestVersion } from "./latest-version"
import { getLocalDevVersion } from "./local-dev-version"

describe("auto-update checker catch fallbacks", () => {
  const originalFetch = globalThis.fetch
  let temporaryDirectory: string | null = null

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()

    if (temporaryDirectory !== null) {
      rmSync(temporaryDirectory, { recursive: true, force: true })
      temporaryDirectory = null
    }
  })

  it("returns null when latest version fetch throws an Error", async () => {
    // given
    globalThis.fetch = mock(async () => {
      throw new Error("network unavailable")
    }) as typeof fetch

    // when
    const version = await getLatestVersion()

    // then
    expect(version).toBeNull()
  })

  it("rethrows non-Error latest version fetch failures", async () => {
    // given
    const nonError = Symbol("network unavailable")
    globalThis.fetch = mock(async () => {
      throw nonError
    }) as typeof fetch

    await expect(getLatestVersion()).rejects.toBe(nonError)
  })

  it("returns null when local dev package JSON is malformed", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-local-dev-version-"))
    temporaryDirectory = directory
    const packageDirectory = join(directory, "packages", "plugin")
    const configDirectory = join(directory, ".opencode")
    mkdirSync(packageDirectory, { recursive: true })
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(join(packageDirectory, "package.json"), "{not-valid-json")
    writeFileSync(
      join(configDirectory, "opencode.json"),
      JSON.stringify({ plugin: [`file://${packageDirectory}`] }),
    )

    // when
    const version = getLocalDevVersion(directory)

    // then
    expect(version).toBeNull()
  })

  it("rethrows non-Error local dev version read failures", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-local-dev-version-"))
    temporaryDirectory = directory
    const packageDirectory = join(directory, "packages", "plugin")
    const configDirectory = join(directory, ".opencode")
    mkdirSync(packageDirectory, { recursive: true })
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(join(packageDirectory, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version: "4.7.5" }))
    writeFileSync(
      join(configDirectory, "opencode.json"),
      JSON.stringify({ plugin: [`file://${packageDirectory}`] }),
    )

    const nonError = Symbol("read failure")
    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation(
      () => {
        throw nonError
      },
    )

    try {
      let thrown: unknown = null
      try {
        getLocalDevVersion(directory)
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }
        thrown = error
      }
      expect(thrown).toBe(nonError)
    } finally {
      readFileSyncSpy.mockRestore()
    }
  })
})
