import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { formatComputerUseDoctorLines } from "../bin/lib/computer-use-doctor.js"
import { computerUseDoctorReport } from "../computer-use-doctor-runtime"
import type { EngineLauncher } from "../computer-use-engine-probe"

const roots: string[] = []

// A fixture engine is a script, and Windows cannot execute a script as a binary (EFTYPE), so the tests start
// it through the running runtime; the production launcher executes the located binary directly.
const runEngineScript: EngineLauncher = (enginePath, args, env) =>
  spawn(process.execPath, [enginePath, ...args], { stdio: "pipe", windowsHide: true, detached: true, env })

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-computer-doctor-failure-"))
  roots.push(root)
  return root
}

function writeConfig(root: string, enginePath: string): void {
  const configDir = join(root, ".omo")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "omo.jsonc"), JSON.stringify({
    "[native]": { computer: { enabled: true, engine_path: enginePath } },
  }))
}

function writeEngine(root: string, body: string): string {
  const enginePath = join(root, "fake-engine.mjs")
  writeFileSync(enginePath, `#!/usr/bin/env node
import { createInterface } from "node:readline";
${body}
`)
  chmodSync(enginePath, 0o755)
  return enginePath
}

function input(root: string) {
  return {
    cwd: root,
    env: { HOME: root },
    version: "5.0.1",
    packageRoot: join(root, "package"),
    platform: "darwin",
    arch: "arm64",
  } as const
}

describe("computer use doctor probe failures", () => {
  test("#given a mismatched engine ABI #when probed #then the report is an ABI failure with the engine path", async () => {
    // given
    const root = fixtureRoot()
    const enginePath = writeEngine(root, `
const replies = {
  "engine.hello": { protocolVersion: "9", engineVersion: "0.0.0", buildSha: "fixture", abi: "other/9" },
  capabilities: {
    backend: "fake", capture: false, input: false, ax: false, backgroundWindowInput: false,
    deliveryModes: [], capturePermission: "denied", inputPermission: "denied", axPermission: "denied",
    displayCount: 0, focusGuard: false, stopPath: "none", screenLocked: false
  }
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: replies[request.method] }) + "\\n");
});
`)
    writeConfig(root, enginePath)

    // when
    const report = await computerUseDoctorReport({ ...input(root), launchEngine: runEngineScript, timeoutMs: 1_000 })

    // then
    expect(report.kind).toBe("failed")
    if (report.kind !== "failed") throw new Error(`expected failed report, got ${report.kind}`)
    expect(report.code).toBe("abi-mismatch")
    expect(report.enginePath).toBe(enginePath)
    expect(formatComputerUseDoctorLines(report)).toContain(
      `INFO computer use engine path: ${enginePath}`,
    )
  })

  test("#given an engine that never replies #when the bounded probe expires #then the report is a timeout", async () => {
    // given
    const root = fixtureRoot()
    const enginePath = writeEngine(root, `
createInterface({ input: process.stdin }).on("line", () => {});
`)
    writeConfig(root, enginePath)

    // when
    const report = await computerUseDoctorReport({ ...input(root), launchEngine: runEngineScript, timeoutMs: 25 })

    // then
    expect(report.kind).toBe("failed")
    if (report.kind !== "failed") throw new Error(`expected failed report, got ${report.kind}`)
    expect(report.code).toBe("timeout")
    expect(report.message).toBe(
      `desktop engine probe timed out after 25 ms at ${enginePath} (phase: requests sent, awaiting engine.hello and capabilities)`,
    )
  })

  test("#given an unsupported platform #when inspected #then no engine process is needed", async () => {
    // given
    const root = fixtureRoot()

    // when
    const report = await computerUseDoctorReport({
      ...input(root),
      platform: "aix",
    })

    // then
    expect(report).toEqual({
      kind: "skipped",
      enabled: false,
      supported: false,
      host: "aix-arm64",
      reason: "unsupported",
    })
  })

  test("#given the default config and no engine installed yet #when inspected #then it is informational, fetches nothing and does not fail doctor", async () => {
    // given: no computer config, no engine at any located path
    const root = fixtureRoot()
    let fetched = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = Object.assign(
      () => {
        fetched += 1
        return Promise.reject(new Error("doctor must not download the engine"))
      },
      { preconnect: realFetch.preconnect },
    ) as typeof fetch

    // when
    let report: Awaited<ReturnType<typeof computerUseDoctorReport>>
    try {
      report = await computerUseDoctorReport(input(root))
    } finally {
      globalThis.fetch = realFetch
    }
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(report.kind).toBe("not-installed")
    expect(fetched).toBe(0)
    expect(lines.filter((line) => line.startsWith("FAIL"))).toEqual([])
    expect(lines).toContain("INFO computer use engine: not installed yet; it is downloaded the first time computer use starts")
  })

  test("#given an explicit engine path that does not exist #when inspected #then it still fails", async () => {
    // given
    const root = fixtureRoot()
    writeConfig(root, join(root, "missing-engine"))

    // when
    const lines = formatComputerUseDoctorLines(await computerUseDoctorReport(input(root)))

    // then
    expect(lines.some((line) => line.startsWith("FAIL computer use engine: native-unavailable"))).toBe(true)
  })
})
