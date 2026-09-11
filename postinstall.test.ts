/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { delimiter } from "node:path"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const postinstallPath = fileURLToPath(new URL("./postinstall.mjs", import.meta.url))
const RENAME_NOTICE =
  "oh-my-openagent: the 'omo' command is now 'omo-agent-toolkit' (the old name was removed in this major release)."
const SUBPROCESS_TEST_TIMEOUT_MS = 30_000
const HANGING_OPENCODE_MS = 60_000

type PostinstallRun = {
  status: number | null
  stdout: string
  stderr: string
}

function runPostinstallInFixtureEnv(options: { readonly pathPrefix?: string; readonly timeoutMs?: number } = {}): PostinstallRun {
  const fixtureHome = mkdtempSync(join(tmpdir(), "omo-postinstall-fixture-"))
  const inheritedPath = process.env.PATH ?? ""
  try {
    const result = spawnSync(process.execPath, [postinstallPath], {
      encoding: "utf8",
      timeout: options.timeoutMs,
      env: {
        ...inheritedPlatformEnv(),
        PATH: options.pathPrefix === undefined ? inheritedPath : `${options.pathPrefix}${delimiter}${inheritedPath}`,
        HOME: fixtureHome,
        USERPROFILE: fixtureHome,
        XDG_CACHE_HOME: join(fixtureHome, "cache"),
      },
    })
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
  } finally {
    rmSync(fixtureHome, { recursive: true, force: true })
  }
}

function writeHangingOpencodeShim(): string {
  const binDir = mkdtempSync(join(tmpdir(), "omo-postinstall-hanging-opencode-"))
  const hang = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, ${HANGING_OPENCODE_MS})"`
  writeFileSync(join(binDir, "opencode"), `#!/bin/sh\nexec ${hang}\n`)
  chmodSync(join(binDir, "opencode"), 0o755)
  writeFileSync(join(binDir, "opencode.cmd"), `@${hang}\r\n`)
  return binDir
}

function inheritedPlatformEnv(): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const key of ["SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "TEMP", "TMP", "windir"]) {
    const value = process.env[key]
    if (value !== undefined) inherited[key] = value
  }
  return inherited
}

function countNoticeLines(output: string): number {
  return output.split("\n").filter((line) => line.trim() === RENAME_NOTICE).length
}

describe("postinstall rename notice", () => {
  test("announces the omo-agent-toolkit rename exactly once", () => {
    // #given
    // a fixture environment isolated from the real HOME and OpenCode plugin cache

    // #when
    const run = runPostinstallInFixtureEnv()

    // #then
    expect(countNoticeLines(run.stdout)).toBe(1)
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("never fails the install regardless of platform binary resolution", () => {
    // #given
    // a fixture environment isolated from the real HOME and OpenCode plugin cache

    // #when
    const run = runPostinstallInFixtureEnv()

    // #then
    expect(run.status).toBe(0)
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("finishes when the opencode version probe never returns", () => {
    // #given
    const hangingBinDir = writeHangingOpencodeShim()

    try {
      // #when
      const startedAt = Date.now()
      const run = runPostinstallInFixtureEnv({ pathPrefix: hangingBinDir, timeoutMs: HANGING_OPENCODE_MS * 2 })

      // #then
      expect(run.status).toBe(0)
      expect(Date.now() - startedAt).toBeLessThan(HANGING_OPENCODE_MS)
    } finally {
      rmSync(hangingBinDir, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("stays idempotent across repeated runs", () => {
    // #given
    const firstRun = runPostinstallInFixtureEnv()

    // #when
    const secondRun = runPostinstallInFixtureEnv()

    // #then
    expect(countNoticeLines(firstRun.stdout)).toBe(1)
    expect(countNoticeLines(secondRun.stdout)).toBe(1)
  }, SUBPROCESS_TEST_TIMEOUT_MS)
})
