import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveXdgDataDir } from "./xdg-data-dir"

const tempPaths: string[] = []

function createTempPath(prefix: string): string {
  const tempPath = mkdtempSync(join(tmpdir(), `${prefix}-`))
  tempPaths.push(tempPath)
  return tempPath
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    rmSync(tempPath, { recursive: true, force: true })
  }
})

describe("resolveXdgDataDir", () => {
  it("#given XDG_DATA_HOME #when resolving data dir #then returns the exact XDG path", () => {
    // given
    const xdgDataHome = createTempPath("utils-xdg")

    // when
    const resolvedDataDir = resolveXdgDataDir("omo-codex", {
      env: { XDG_DATA_HOME: xdgDataHome },
    })

    // then
    expect(resolvedDataDir).toBe(xdgDataHome)
  })

  it("#given XDG_DATA_HOME points to a file #when resolving data dir #then falls back to app-specific tmp path", () => {
    // given
    const nonDirectoryRoot = createTempPath("utils-xdg-file")
    const nonDirectoryPath = join(nonDirectoryRoot, "xdg-data-home")
    const tmpRoot = createTempPath("utils-tmp")
    writeFileSync(nonDirectoryPath, "not-a-directory", "utf-8")

    // when
    const resolvedDataDir = resolveXdgDataDir("opencode", {
      env: { XDG_DATA_HOME: nonDirectoryPath },
      osProvider: {
        homedir: () => createTempPath("unused-home"),
        tmpdir: () => tmpRoot,
      },
    })

    // then
    expect(resolvedDataDir).toBe(join(tmpRoot, "opencode-data"))
  })

  it("#given XDG_DATA_HOME is absent #when resolving data dir #then uses provider homedir local share path", () => {
    // given
    const homeRoot = createTempPath("utils-home")
    const tmpRoot = createTempPath("utils-tmp")

    // when
    const resolvedDataDir = resolveXdgDataDir("omo-codex", {
      env: {},
      osProvider: {
        homedir: () => homeRoot,
        tmpdir: () => tmpRoot,
      },
    })

    // then
    expect(resolvedDataDir).toBe(join(homeRoot, ".local", "share"))
  })
})
