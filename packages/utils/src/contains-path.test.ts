import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import * as realFs from "fs"
import { tmpdir } from "os"
import { join } from "path"

const tempDirectories: string[] = []
const originalRealpathNative = realFs.realpathSync.native.bind(realFs.realpathSync)

afterEach(() => {
  mock.restore()

  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("containsPath", () => {
  test("#given realpath fails for a missing candidate ancestor #when checking containment #then falls back to the resolved ancestor path", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-contains-path-"))
    tempDirectories.push(root)
    const missingCandidate = join(root, "missing", "file.txt")

    mock.module("fs", () => ({
      ...realFs,
      realpathSync: {
        ...realFs.realpathSync,
        native: (path: string): string => {
          if (path === root) throw new Error("simulated realpath race")
          return originalRealpathNative(path)
        },
      },
    }))
    const { containsPath } = await import(`./contains-path?test=${Date.now()}-${Math.random()}`)

    // when / then
    expect(containsPath(root, missingCandidate)).toBe(true)
  })
})
