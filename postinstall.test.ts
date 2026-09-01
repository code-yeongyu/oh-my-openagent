/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const postinstallPath = fileURLToPath(new URL("./postinstall.mjs", import.meta.url))
const RENAME_NOTICE =
  "oh-my-openagent: the 'omo' command is now 'omo-agent-toolkit' (the old name was removed in this major release)."

type PostinstallRun = {
  status: number | null
  stdout: string
  stderr: string
}

function runPostinstallInFixtureEnv(): PostinstallRun {
  const fixtureHome = mkdtempSync(join(tmpdir(), "omo-postinstall-fixture-"))
  try {
    const result = spawnSync(process.execPath, [postinstallPath], {
      encoding: "utf8",
      env: {
        ...inheritedPlatformEnv(),
        PATH: process.env.PATH ?? "",
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
  })

  test("never fails the install regardless of platform binary resolution", () => {
    // #given
    // a fixture environment isolated from the real HOME and OpenCode plugin cache

    // #when
    const run = runPostinstallInFixtureEnv()

    // #then
    expect(run.status).toBe(0)
  })

  test("stays idempotent across repeated runs", () => {
    // #given
    const firstRun = runPostinstallInFixtureEnv()

    // #when
    const secondRun = runPostinstallInFixtureEnv()

    // #then
    expect(countNoticeLines(firstRun.stdout)).toBe(1)
    expect(countNoticeLines(secondRun.stdout)).toBe(1)
  })
})
