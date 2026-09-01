import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findSgBinarySync } from "./sg-resolver"
import { SG_PATH_ENV_KEY } from "./types"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

/**
 * Fixtures must be genuinely runnable: every candidate has to pass a real `--version` probe, so a
 * stub that cannot execute is a rejected candidate, not a resolvable one.
 */
function writeExecutable(filePath: string): void {
  writeFileSync(filePath, "#!/bin/sh\nprintf 'ast-grep 0.43.0\\n'\n")
  chmodSync(filePath, 0o755)
}

/** Home directory with no OMO runtime, so tier-2 candidates cannot shadow the tier under test. */
const NO_RUNTIME_HOME = join(tmpdir(), "omo-sg-resolver-no-runtime-home")

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
      runVersionProbeSync: () => "ast-grep 0.43.0",
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
    const runtimeSg = join(runtimeDir, process.platform === "win32" ? "sg.exe" : "sg")
    writeExecutable(runtimeSg)

    // when
    const result = findSgBinarySync({
      env: {},
      fileExists: (filePath) => filePath === runtimeSg,
      platform: process.platform,
      runVersionProbeSync: () => "ast-grep 0.43.0",
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

  it("prefers ast-grep over sg on darwin without probing the noisy sg alias", () => {
    // given: only the PATH tier has candidates, so the assertion targets ast-grep-over-sg ordering
    const probed: string[] = []
    const astGrep = "/usr/local/bin/ast-grep"
    const sgAlias = "/usr/local/bin/sg"

    // when
    const result = findSgBinarySync({
      cache: false,
      env: {},
      fileExists: (filePath) => filePath === astGrep || filePath === sgAlias,
      homeDir: NO_RUNTIME_HOME,
      platform: "darwin",
      runVersionProbeSync: (binaryPath) => {
        probed.push(binaryPath)
        if (binaryPath === sgAlias) throw new Error("the sg alias probe must never run when ast-grep passes")
        return "ast-grep 0.45.0"
      },
      which: (commandName) => (commandName === "ast-grep" ? astGrep : sgAlias),
    })

    // then: ast-grep passes its probe, so the noisy sg alias is never spawned
    expect(result).toBe(astGrep)
    expect(probed).toEqual([astGrep])
  })

  it("prefers ast-grep over sg on win32 without probing the noisy sg alias", () => {
    // given: only the PATH tier has candidates, so the assertion targets ast-grep-over-sg ordering
    const probed: string[] = []
    const astGrep = "C:\\tools\\ast-grep.exe"
    const sgAlias = "C:\\tools\\sg.exe"

    // when
    const result = findSgBinarySync({
      cache: false,
      env: {},
      fileExists: (filePath) => filePath === astGrep || filePath === sgAlias,
      homeDir: NO_RUNTIME_HOME,
      platform: "win32",
      runVersionProbeSync: (binaryPath) => {
        probed.push(binaryPath)
        if (binaryPath === sgAlias) throw new Error("the sg alias probe must never run when ast-grep passes")
        return "ast-grep 0.45.0"
      },
      which: (commandName) => (commandName === "ast-grep" ? astGrep : sgAlias),
    })

    // then: ast-grep passes its probe, so the noisy sg alias is never spawned
    expect(result).toBe(astGrep)
    expect(probed).toEqual([astGrep])
  })

  it("falls back to the sg alias on darwin when ast-grep is absent", () => {
    // given
    const sgAlias = join("/opt/homebrew/bin", "sg")

    // when
    const result = findSgBinarySync({
      cache: false,
      env: {},
      fileExists: (filePath) => filePath === sgAlias,
      homeDir: NO_RUNTIME_HOME,
      platform: "darwin",
      runVersionProbeSync: () => "ast-grep 0.45.0",
      which: (commandName) => (commandName === "sg" ? sgAlias : null),
    })

    // then
    expect(result).toBe(sgAlias)
  })

  it("keeps the probed binary's stderr out of the parent process", () => {
    // shell-script fixture; the leak under test is POSIX stderr inheritance
    if (process.platform === "win32") return

    // given: a fake sg that prints the ast-grep 0.45 deprecation banner on stderr and the version on stdout
    const root = tempDir("sg-stderr")
    mkdirSync(root, { recursive: true })
    const fakeSg = join(root, "sg")
    writeFileSync(
      fakeSg,
      "#!/bin/sh\nprintf 'WARNING: `sg` is deprecated. Use `ast-grep` instead.\\n' >&2\nprintf 'ast-grep 0.45.0\\n'\n",
    )
    chmodSync(fakeSg, 0o755)
    const runnerPath = join(root, "runner.ts")
    const resolverPath = join(import.meta.dir, "sg-resolver.ts")
    writeFileSync(
      runnerPath,
      [
        `import { findSgBinarySync } from ${JSON.stringify(resolverPath)}`,
        `const result = findSgBinarySync({`,
        `  cache: false,`,
        `  env: {},`,
        `  homeDir: ${JSON.stringify(NO_RUNTIME_HOME)},`,
        `  platform: "darwin",`,
        `  which: (commandName) => (commandName === "sg" ? ${JSON.stringify(fakeSg)} : null),`,
        `})`,
        `console.log(JSON.stringify({ result }))`,
      ].join("\n"),
    )

    // when: resolve with the DEFAULT version probe inside a child process so inherited stderr is observable
    const child = Bun.spawnSync(["bun", runnerPath], { stderr: "pipe", stdout: "pipe" })
    const childStdout = child.stdout.toString()
    const childStderr = child.stderr.toString()

    // then: the fake sg resolves, and nothing the probe wrote to stderr escapes the resolver
    expect(JSON.parse(childStdout.trim())).toEqual({ result: fakeSg })
    expect(childStderr).not.toMatch(/deprecated|WARNING/)

    rmSync(root, { force: true, recursive: true })
  })

  it("prefers ast-grep over Linux setgroups sg collisions", () => {
    // given
    const linuxSetgroups = "/usr/bin/sg"
    const astGrep = "/usr/local/bin/ast-grep"

    // when
    const result = findSgBinarySync({
      cache: false,
      env: {},
      fileExists: (filePath) => filePath === linuxSetgroups || filePath === astGrep,
      homeDir: NO_RUNTIME_HOME,
      platform: "linux",
      runVersionProbeSync: (binaryPath) => (binaryPath === linuxSetgroups ? "sg from shadow-utils" : "ast-grep 0.43.0"),
      which: (commandName) => (commandName === "ast-grep" ? astGrep : linuxSetgroups),
    })

    // then
    expect(result).toBe(astGrep)
  })
})
