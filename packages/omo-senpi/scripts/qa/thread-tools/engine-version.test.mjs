import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { withTelemetryOptOut } from "../telemetry-opt-out-env.mjs"
import { QA_TMP_ROOT } from "./lib/qa-tmp.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const omoSenpiManifest = resolve(here, "..", "..", "..", "package.json")
const PINNED = JSON.parse(readFileSync(omoSenpiManifest, "utf8")).devDependencies["@code-yeongyu/senpi"]
const REFUSAL = `THREAD_QA_SENPI_VERSION is not set; set it to the engine under test (omo pins ${PINNED})`
const SCRATCH_PREFIX = "qa-thread-tools-tui-to-tui-"
// A circuit breaker for a child that hangs instead of refusing; a refusal returns in well under a second.
const CHILD_TIMEOUT_MS = 60_000

let work
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "thread-qa-engine-version-"))
})
afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/**
 * Run a gateway entry point with the engine version unset (or empty). The kit dir sits under a regular
 * file, so a build that does NOT refuse fails at its first kit write instead of installing an engine
 * from the network: the test stays hermetic either way, and a missing refusal still shows as a failure.
 */
function runEntry(args, engineVersion) {
  const blocker = join(work, "blocker")
  writeFileSync(blocker, "not a directory\n")
  const env = withTelemetryOptOut({ ...process.env, THREAD_QA_KIT_DIR: join(blocker, "kit") })
  delete env.THREAD_QA_SENPI_VERSION
  if (engineVersion !== undefined) env.THREAD_QA_SENPI_VERSION = engineVersion
  const scratchBefore = new Set(readdirSync(QA_TMP_ROOT).filter((name) => name.startsWith(SCRATCH_PREFIX)))
  const child = Bun.spawnSync([process.execPath, ...args], { env, stdout: "pipe", stderr: "pipe", timeout: CHILD_TIMEOUT_MS })
  const scratchAfter = readdirSync(QA_TMP_ROOT).filter((name) => name.startsWith(SCRATCH_PREFIX) && !scratchBefore.has(name))
  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString(), newScratch: scratchAfter }
}

describe("thread-tool gateway QA engine version", () => {
  test.each([
    ["unset", undefined],
    ["empty", ""],
  ])("#given THREAD_QA_SENPI_VERSION %s #when run-all runs the gateway suite #then it refuses before running any scenario", (_label, engineVersion) => {
    const outDir = join(work, "out")

    const result = runEntry([join(here, "run-all.mjs"), "--suite", "gateway", "--out-dir", outDir], engineVersion)

    expect(result.code).not.toBe(0)
    expect(result.stderr.trim()).toBe(REFUSAL)
    expect(result.stdout).not.toContain("=====")
    expect(existsSync(outDir)).toBe(false)
    expect(result.newScratch).toEqual([])
  }, CHILD_TIMEOUT_MS)

  test("#given THREAD_QA_SENPI_VERSION unset #when a gateway scenario runs on its own #then it refuses before creating evidence or scratch dirs", () => {
    const evidence = join(work, "evidence")

    const result = runEntry([join(here, "tui-to-tui.mjs"), "--out", join(work, "report", "tui-to-tui.txt"), "--evidence-dir", evidence])

    expect(result.code).not.toBe(0)
    expect(result.stderr.trim()).toBe(REFUSAL)
    expect(existsSync(evidence)).toBe(false)
    expect(existsSync(join(work, "report"))).toBe(false)
    expect(result.newScratch).toEqual([])
  }, CHILD_TIMEOUT_MS)
})
