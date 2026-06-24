import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findSgBinarySync } from "./sg-resolver"
import { SG_PATH_ENV_KEY } from "./types"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

function writeExecutable(filePath: string): void {
  writeFileSync(filePath, "#!/bin/sh\nprintf 'ast-grep 0.43.0\\n'\n")
}

describe("findSgBinarySync", () => {
  it("prefers the OMO_AST_GREP_SG_PATH override", () => {
    // given
    const root = tempDir("sg-env")
    mkdirSync(root, { recursive: true })
    const overridePath = join(root, "custom-sg")
    writeExecutable(overridePath)

    // when
    const result = findSgBinarySync({
      env: { [SG_PATH_ENV_KEY]: overridePath },
      fileExists: (filePath) => filePath === overridePath,
      runtimeDir: join(root, "runtime"),
      which: () => join(root, "path-sg"),
    })

    // then
    expect(result).toBe(overridePath)

    rmSync(root, { force: true, recursive: true })
  })

  it("uses the harness runtime directory before PATH", () => {
    // given
    const root = tempDir("sg-runtime")
    const runtimeDir = join(root, "runtime")
    mkdirSync(runtimeDir, { recursive: true })
    const runtimeSg = join(runtimeDir, "sg")
    writeExecutable(runtimeSg)

    // when
    const result = findSgBinarySync({
      env: {},
      fileExists: (filePath) => filePath === runtimeSg,
      platform: "linux",
      runtimeDir,
      which: () => join(root, "path-sg"),
    })

    // then
    expect(result).toBe(runtimeSg)

    rmSync(root, { force: true, recursive: true })
  })

  it("returns null without throwing when nothing resolves", () => {
    // given
    const missing = {
      env: {},
      fileExists: () => false,
      runVersionProbeSync: () => {
        throw new Error("should not matter")
      },
      which: () => null,
    }

    // when
    const result = findSgBinarySync(missing)

    // then
    expect(result).toBeNull()
  })

  it("prefers ast-grep over Linux setgroups sg collisions", () => {
    // given
    const linuxSetgroups = "/usr/bin/sg"
    const astGrep = "/usr/local/bin/ast-grep"

    // when
    const result = findSgBinarySync({
      env: {},
      fileExists: () => true,
      platform: "linux",
      runVersionProbeSync: () => "sg from shadow-utils",
      which: (commandName) => (commandName === "ast-grep" ? astGrep : linuxSetgroups),
    })

    // then
    expect(result).toBe(astGrep)
  })
})
