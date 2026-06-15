import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getDataDir, getOpenCodeStorageDir } from "./data-path"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempPaths: string[] = []

function createTempPath(prefix: string): string {
  const tempPath = mkdtempSync(join(tmpdir(), `${prefix}-`))
  tempPaths.push(tempPath)
  return tempPath
}

afterEach(() => {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }

  for (const tempPath of tempPaths.splice(0)) {
    rmSync(tempPath, { recursive: true, force: true })
  }
})

describe("opencode data path", () => {
  it("#given XDG_DATA_HOME #when resolving data dir #then returns the exact XDG path", () => {
    // given
    const xdgDataHome = createTempPath("opencode-xdg")
    process.env.XDG_DATA_HOME = xdgDataHome

    // when
    const resolvedDataDir = getDataDir()

    // then
    expect(resolvedDataDir).toBe(xdgDataHome)
  })

  it("#given XDG_DATA_HOME points to a file #when resolving data dir #then falls back to opencode-data in tmp", () => {
    // given
    const nonDirectoryRoot = createTempPath("opencode-xdg-file")
    const nonDirectoryPath = join(nonDirectoryRoot, "xdg-data-home")
    writeFileSync(nonDirectoryPath, "not-a-directory", "utf-8")
    process.env.XDG_DATA_HOME = nonDirectoryPath

    // when
    const resolvedDataDir = getDataDir()

    // then
    expect(resolvedDataDir).toBe(join(tmpdir(), "opencode-data"))
  })

  it("#given XDG_DATA_HOME #when resolving storage dir #then appends opencode storage path byte-for-byte", () => {
    // given
    const xdgDataHome = createTempPath("opencode-storage")
    process.env.XDG_DATA_HOME = xdgDataHome

    // when
    const storageDir = getOpenCodeStorageDir()

    // then
    expect(storageDir).toBe(join(xdgDataHome, "opencode", "storage"))
  })
})
