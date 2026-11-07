/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter } from "node:path"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const postinstallPath = fileURLToPath(new URL("./postinstall.mjs", import.meta.url))
const RENAME_NOTICE =
  "oh-my-openagent: the 'omo' command is now 'omo-agent-toolkit' (the old name was removed in this major release)."
const PACKAGE_VERSION: string = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")).version
const NATIVE_NOTICE = `oh-my-openagent: OmO Native is the same omo as one 'omo' command, with no OpenCode host: bun add -g ${PACKAGE_VERSION.includes("-") ? "omo-ai@beta" : "omo-ai"}`
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
        TMPDIR: fixtureHome,
        TMP: fixtureHome,
        TEMP: fixtureHome,
      },
    })
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
  } finally {
    rmSync(fixtureHome, { recursive: true, force: true })
  }
}

function writeOpencodeShim(source: string): string {
  const binDir = mkdtempSync(join(tmpdir(), "omo-postinstall-hanging-opencode-"))
  const script = join(binDir, "opencode.mjs")
  writeFileSync(script, source)
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
  writeFileSync(join(binDir, "opencode"), `#!/bin/sh\nexec ${command}\n`)
  chmodSync(join(binDir, "opencode"), 0o755)
  writeFileSync(join(binDir, "opencode.cmd"), `@${command}\r\n`)
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

function countNativeNotices(output: string): number {
  return output.split("\n").filter((line) => line.trim() === NATIVE_NOTICE).length
}

describe("postinstall rename notice", () => {
  test("#given a formatter import #when evaluated #then installation does not run", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-postinstall-import-"))
    const marker = join(root, "probe-called")
    const binDir = writeOpencodeShim(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "called"); console.log("1.4.0")`)
    const cache = join(root, "cache", "opencode", "oh-my-openagent@fixture")
    mkdirSync(cache, { recursive: true })
    const script = join(root, "import.mjs")
    writeFileSync(script, `import { nativeNotice } from ${JSON.stringify(pathToFileURL(postinstallPath).href)}; if (!nativeNotice("5.0.0").endsWith("omo-ai")) throw new Error("wrong channel")`)
    try {
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: {
          ...inheritedPlatformEnv(),
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
          HOME: root,
          USERPROFILE: root,
          XDG_CACHE_HOME: join(root, "cache"),
          TMPDIR: root,
          TMP: root,
          TEMP: root,
        },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(cache)).toBe(true)
    } finally {
      rmSync(binDir, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("#given a version probe using temporary storage #when installation ends #then its artifacts are removed", () => {
    const artifact = `omo-postinstall-native-probe-${randomUUID()}`
    const leakedPath = join(tmpdir(), artifact)
    const binDir = writeOpencodeShim(`
      import { writeFileSync } from "node:fs"
      import { tmpdir } from "node:os"
      import { join } from "node:path"
      writeFileSync(join(tmpdir(), ${JSON.stringify(artifact)}), "runtime artifact")
      console.log("1.4.0")
    `)
    try {
      const run = runPostinstallInFixtureEnv({ pathPrefix: binDir })
      expect(run.status).toBe(0)
      expect(existsSync(leakedPath)).toBe(false)
    } finally {
      rmSync(leakedPath, { force: true })
      rmSync(binDir, { recursive: true, force: true })
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS)

  test("names the install line of the package's own channel", async () => {
    const { nativeNotice } = await import("./postinstall.mjs")
    expect(nativeNotice("5.0.0")).toEndWith("bun add -g omo-ai")
    expect(nativeNotice("5.0.0-beta.90")).toEndWith("bun add -g omo-ai@beta")
  })

  test("announces the omo-agent-toolkit rename exactly once", () => {
    // #given
    // a fixture environment isolated from the real HOME and OpenCode plugin cache

    // #when
    const run = runPostinstallInFixtureEnv()

    // #then
    expect(countNoticeLines(run.stdout)).toBe(1)
    expect(countNativeNotices(run.stdout)).toBe(1)
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
    const hangingBinDir = writeOpencodeShim(`setTimeout(() => {}, ${HANGING_OPENCODE_MS})`)

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
    expect(countNativeNotices(firstRun.stdout)).toBe(1)
    expect(countNativeNotices(secondRun.stdout)).toBe(1)
  }, SUBPROCESS_TEST_TIMEOUT_MS)
})
