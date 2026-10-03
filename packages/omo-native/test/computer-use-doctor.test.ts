import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { formatComputerUseDoctorLines } from "../bin/lib/computer-use-doctor.js"
import {
  computerUseDoctorReport,
  type ComputerUseDoctorReport,
} from "../computer-use-doctor-runtime"
import type { EngineLauncher } from "../computer-use-engine-probe"
import * as releaseSignature from "../../senpi-desktop-engine/src/release-signature"
import { describeEngineSource } from "../../omo-senpi/src/components/computer-use/engine-source"

const roots: string[] = []

// A fixture engine is a script, and Windows cannot execute a script as a binary (EFTYPE), so the tests start
// it through the running runtime; the production launcher executes the located binary directly.
const runEngineScript: EngineLauncher = (enginePath, args, env) =>
  spawn(process.execPath, [enginePath, ...args], { stdio: "pipe", windowsHide: true, detached: true, env })

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function readyReport(overrides: Partial<Extract<ComputerUseDoctorReport, { kind: "ready" }>> = {}): Extract<ComputerUseDoctorReport, { kind: "ready" }> {
  return {
    kind: "ready",
    enabled: true,
    supported: true,
    host: "darwin-arm64",
    enginePath: "/tmp/senpi-desktop-engine",
    engineSource: "explicit",
    hello: {
      protocolVersion: "1",
      engineVersion: "0.1.0",
      buildSha: "abc123",
      abi: "senpi-desktop/1",
    },
    capabilities: {
      backend: "quartz",
      displayServer: "Quartz WindowServer",
      capture: true,
      input: true,
      ax: true,
      backgroundWindowInput: true,
      deliveryModes: ["background", "foreground"],
      capturePermission: "granted",
      inputPermission: "granted",
      axPermission: "granted",
      displayCount: 2,
      focusGuard: true,
      stopPath: "global",
      screenLocked: false,
    },
    ...overrides,
  }
}

function fakeEngine(root: string): { readonly path: string; readonly log: string } {
  const path = join(root, "fake-engine.mjs")
  const log = join(root, "requests.jsonl")
  writeFileSync(path, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const replies = {
  "engine.hello": { protocolVersion: "1", engineVersion: "0.1.0", buildSha: "fixture", abi: "senpi-desktop/1" },
  capabilities: {
    backend: "quartz", displayServer: "Quartz WindowServer", capture: true, input: true, ax: true,
    backgroundWindowInput: true, deliveryModes: ["background", "foreground"],
    capturePermission: "granted", inputPermission: "granted", axPermission: "granted",
    displayCount: 2, focusGuard: true, stopPath: "global", screenLocked: false
  }
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  appendFileSync(process.env.OMO_TEST_REQUEST_LOG, JSON.stringify(request) + "\\n");
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: replies[request.method] }) + "\\n");
});
`)
  chmodSync(path, 0o755)
  return { path, log }
}

describe("computer use doctor rendering", () => {
  test("#given a ready engine #when rendered #then every requested health dimension passes", () => {
    // given
    const report = readyReport()

    // when
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(lines).toEqual([
      "INFO computer use: enabled=true supported=true host=darwin-arm64",
      "PASS computer use engine: ready (explicit) /tmp/senpi-desktop-engine (version 0.1.0, ABI senpi-desktop/1, protocol 1)",
      "PASS computer use backend: quartz (Quartz WindowServer)",
      "PASS computer use permissions: capture=granted input=granted accessibility=granted",
      "PASS computer use display: count=2 screenLocked=false",
      "PASS computer use stop path: global",
    ])
  })

  test("#given the idle stop path a pre-session probe reports #when rendered #then it is informational, not a warning", () => {
    // given
    const report = readyReport({
      capabilities: { ...readyReport().capabilities, stopPath: "none", stopReason: "no-global-listener" },
    })

    // when
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(lines.at(-1)).toStartWith("INFO computer use stop path:")
    expect(lines.filter((line) => line.startsWith("WARN"))).toEqual([])
  })

  test("#given denied permissions, a locked empty display, and a failed stop path #when rendered #then each degraded dimension warns", () => {
    // given
    const report = readyReport({
      capabilities: {
        ...readyReport().capabilities,
        capture: false,
        input: false,
        ax: false,
        capturePermission: "denied",
        inputPermission: "denied",
        axPermission: "denied",
        displayCount: 0,
        screenLocked: true,
        stopPath: "none",
        stopReason: "portal-unavailable",
      },
    })

    // when
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(lines).toContain("WARN computer use permissions: capture=denied input=denied accessibility=denied")
    expect(lines).toContain("WARN computer use display: count=0 screenLocked=true")
    expect(lines).toContain("WARN computer use stop path: none reason=portal-unavailable")
  })

  test("#given a quarantined engine #when rendered #then the diagnostic and every tried path are visible", () => {
    // given
    const report: ComputerUseDoctorReport = {
      kind: "unavailable",
      enabled: true,
      supported: true,
      host: "darwin-arm64",
      diagnostic: {
        code: "quarantined",
        message: "The engine is quarantined.",
        cause: "com.apple.quarantine is present",
        attemptedPaths: ["/one/engine", "/two/engine"],
      },
    }

    // when
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(lines).toContain("FAIL computer use engine: quarantined: The engine is quarantined. com.apple.quarantine is present")
    expect(lines).toContain("INFO computer use engine paths tried: /one/engine, /two/engine")
  })

  test("#given computer use is disabled #when rendered #then the probe is explicitly skipped", () => {
    // given
    const report: ComputerUseDoctorReport = {
      kind: "skipped",
      enabled: false,
      supported: true,
      host: "darwin-arm64",
      reason: "disabled",
    }

    // when
    const lines = formatComputerUseDoctorLines(report)

    // then
    expect(lines).toEqual([
      "INFO computer use: enabled=false supported=true host=darwin-arm64",
      "INFO computer use probe: skipped because computer.enabled=false",
    ])
  })
})

describe("computer use doctor probe", () => {
  test("#given a verified release cache #when inspected #then doctor probes it without fetching", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-computer-doctor-cache-"))
    roots.push(home)
    const engine = fakeEngine(home)
    const bytes = readFileSync(engine.path)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const generation = join(home, ".omo", "cache", "senpi-desktop-engine", "5.1.4", "darwin-arm64", `${digest}-${randomUUID()}`)
    mkdirSync(generation, { recursive: true })
    const cached = join(generation, "senpi-desktop-engine-darwin-arm64")
    writeFileSync(cached, bytes)
    chmodSync(cached, 0o755)
    let fetched = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = Object.assign(() => {
      fetched += 1
      throw new Error("doctor must not fetch")
    }, { preconnect: realFetch.preconnect })
    const signature = spyOn(releaseSignature, "isDesktopEngineRelease").mockReturnValue(true)
    const launchedPaths: string[] = []
    let report: ComputerUseDoctorReport
    try {
      report = await computerUseDoctorReport({
        cwd: home, env: { HOME: home, OMO_TEST_REQUEST_LOG: engine.log },
        version: "5.1.4", packageRoot: join(home, "package"),
        platform: "darwin", arch: "arm64", launchEngine: (path, args, env) => {
          launchedPaths.push(path)
          return runEngineScript(path, args, env)
        },
      })
    } finally {
      globalThis.fetch = realFetch
      signature.mockRestore()
    }
    expect(report.kind).toBe("ready")
    expect(report).toMatchObject({ enginePath: cached, engineSource: "cache" })
    const stable = join(home, ".omo", "engines", "senpi-desktop-engine", "darwin-arm64", "senpi-desktop-engine")
    expect(launchedPaths).toEqual([stable])
    expect(report).toMatchObject({ launchedEnginePath: stable })
    const stamped = join(home, "stamped")
    mkdirSync(stamped)
    writeFileSync(join(stamped, "package.json"), JSON.stringify({ name: "omo", version: "5.1.4" }))
    expect(describeEngineSource(undefined, { HOME: home, OMO_PACKAGE_DIR: stamped }, {
      platform: "darwin", arch: "arm64", execDir: join(home, "bin"),
      packageDir: join(home, "engine-package"), repoRoot: home,
    })).toBe(`found ${cached} (cache, omo v5.1.4)`)
    expect(formatComputerUseDoctorLines(report)).toContain(`INFO computer use launched executable: ${stable}`)
    expect(fetched).toBe(0)
    expect(readFileSync(engine.log, "utf8").trim().split("\n").map((line) => JSON.parse(line).method))
      .toEqual(["engine.hello", "capabilities"])
  })

  test.each(["linux", "win32"])("#given no engine built for %s-arm64 #when inspected #then doctor reports unavailable", async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "omo-computer-doctor-host-"))
    roots.push(home)
    const report = await computerUseDoctorReport({
      cwd: home, env: { HOME: home }, version: "5.1.4",
      packageRoot: join(home, "package"), platform, arch: "arm64",
    })
    expect(report.kind).toBe("unavailable")
    expect(report).toMatchObject({ diagnostic: { reason: "no-release-asset", host: `${platform}-arm64` } })
  })

  test("#given an explicit engine path in the effective Native config #when probed #then only hello and capabilities run before EOF", async () => {
    // given
    const home = mkdtempSync(join(tmpdir(), "omo-computer-doctor-"))
    roots.push(home)
    const engine = fakeEngine(home)
    const configDir = join(home, ".omo")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "omo.jsonc"), JSON.stringify({
      "[native]": { computer: { enabled: true, engine_path: engine.path } },
    }))

    // when
    const report = await computerUseDoctorReport({
      cwd: home,
      env: { HOME: home, OMO_TEST_REQUEST_LOG: engine.log },
      version: "5.0.1",
      packageRoot: join(home, "package"),
      platform: "darwin",
      arch: "arm64",
      launchEngine: runEngineScript,
      timeoutMs: 1_000,
    })

    // then
    expect(report.kind).toBe("ready")
    if (report.kind !== "ready") throw new Error(`expected ready report, got ${report.kind}`)
    expect(report.enginePath).toBe(engine.path)
    const methods = readFileSync(engine.log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).method)
    expect(methods).toEqual(["engine.hello", "capabilities"])
    expect(methods).not.toContain("session.open")
  })
})
