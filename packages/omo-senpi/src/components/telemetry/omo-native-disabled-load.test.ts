import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { summaryDir } from "./session-summary-purge"

// Privacy promise (lead, 2026-10-20): with telemetry off, nothing telemetry-related loads and nothing is
// written. Each case runs the real component in a child process whose Bun onLoad hook records every
// TypeScript module it loads, so the assertion is about real module loads and no module mock can leak
// into other test files. The opted-in run is the positive control that the hook sees the sidecar load.
// The first-run case is the desktop's placeholder `telemetry.enabled: false`, read through the real
// config loader before the user answered.

const HERE = import.meta.dir
const SIDECAR = /[\\/]session-summary-recovery\.ts$/

type Setup = { readonly env: Record<string, string>; readonly configEnabled?: boolean }
type Run = { readonly sidecarLoaded: boolean; readonly transport: number; readonly stateFiles: readonly string[] }

const DISABLED: readonly (readonly [string, (agentDir: string) => Setup])[] = [
  ["OMO_DISABLE_TELEMETRY=1", () => ({ env: { OMO_DISABLE_TELEMETRY: "1" }, configEnabled: true })],
  ["telemetry.enabled false in config", () => ({ env: {}, configEnabled: false })],
  ["first run before consent (placeholder config)", (agentDir) => {
    mkdirSync(join(agentDir, ".omo"), { recursive: true })
    writeFileSync(join(agentDir, ".omo", "omo.jsonc"), JSON.stringify({ telemetry: { enabled: false } }))
    return { env: { HOME: agentDir } }
  }],
]

async function runSession(agentDir: string, setup: Setup, turns = 2): Promise<Run> {
  const work = mkdtempSync(join(tmpdir(), "omo-native-load-spy-"))
  try {
    const out = join(work, "loaded.json")
    const result = join(work, "result.json")
    const stateDir = join(agentDir, "omo-senpi", "omo-native")
    writeFileSync(join(work, "spy.ts"), [
      'import { readFileSync, writeFileSync } from "node:fs"',
      "const seen: string[] = []",
      'Bun.plugin({ name: "load-spy", setup(build) { build.onLoad({ filter: /\\.ts$/ }, (args) => { seen.push(args.path); return { contents: readFileSync(args.path, "utf8"), loader: "ts" } }) } })',
      `process.on("exit", () => writeFileSync(${JSON.stringify(out)}, JSON.stringify(seen)))`,
    ].join("\n"))
    writeFileSync(join(work, "probe.ts"), [
      'import { readdirSync, existsSync, writeFileSync } from "node:fs"',
      `const { FakeExtensionAPI } = await import(${JSON.stringify(join(HERE, "../../../test-support/fake-extension-api.ts"))})`,
      `const { createOmoNativeTelemetryComponent } = await import(${JSON.stringify(join(HERE, "omo-native-component.ts"))})`,
      `const support = await import(${JSON.stringify(join(HERE, "telemetry.test-support.ts"))})`,
      `const setup = ${JSON.stringify(setup)}`,
      `const agentDir = ${JSON.stringify(agentDir)}`,
      `const stateDir = ${JSON.stringify(stateDir)}`,
      "let transport = 0",
      "const pi = new FakeExtensionAPI()",
      "createOmoNativeTelemetryComponent({",
      "  env: { ...support.createEnabledEnv(agentDir), ...setup.env },",
      "  ...(setup.configEnabled === undefined ? {} : { isConfigEnabled: () => setup.configEnabled }),",
      "  accountHomeDir: agentDir,",
      "  rawTurnSampleRate: 1,",
      "  now: support.FIXED_NOW,",
      '  osProvider: support.createOsProvider("load-spy-host"),',
      "  scheduleConsentCheck: () => () => undefined,",
      "  stateDir,",
      "  transportFactory: () => { transport += 1; return { capture() {}, async captureImmediate() {}, async flush() {}, async shutdown() {} } },",
      "}).register(pi, { config: pi, logger: support.createSilentLogger() })",
      'const ctx = { cwd: agentDir, sessionManager: { getSessionId: () => "load-spy" } }',
      'await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, ctx)',
      `for (let i = 0; i < ${turns}; i += 1) await pi.dispatch("turn_end", { type: "turn_end", turnIndex: i, message: { role: "assistant", content: [], provider: "openai", model: "gpt-5.6-sol", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.0002 } }, stopReason: "stop", timestamp: 1 }, toolResults: [] }, ctx)`,
      'await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)',
      "const stateFiles = existsSync(stateDir) ? readdirSync(stateDir, { recursive: true, encoding: \"utf8\" }).map((name) => name.replaceAll(\"\\\\\", \"/\")) : []",
      `writeFileSync(${JSON.stringify(result)}, JSON.stringify({ transport, stateFiles }))`,
    ].join("\n"))
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
    for (const name of ["SENPI_CODING_AGENT_DIR", "OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) env[name] = agentDir
    const child = Bun.spawn([process.execPath, "--preload", join(work, "spy.ts"), join(work, "probe.ts")], { cwd: HERE, env, stdout: "pipe", stderr: "pipe" })
    const timeout = setTimeout(() => child.kill(), 60_000)
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
    clearTimeout(timeout)
    expect(exitCode, stderr).toBe(0)
    const loaded: string[] = JSON.parse(await Bun.file(out).text())
    const outcome: { transport: number; stateFiles: string[] } = JSON.parse(await Bun.file(result).text())
    return { sidecarLoaded: loaded.some((path) => SIDECAR.test(path)), transport: outcome.transport, stateFiles: outcome.stateFiles }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function withAgentDir<T>(run: (agentDir: string) => Promise<T>): Promise<T> {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-native-load-spy-agent-"))
  return run(agentDir).finally(() => rmSync(agentDir, { recursive: true, force: true }))
}

const seedQueue = (stateDir: string): void => {
  const pending = join(summaryDir(stateDir), "pending")
  mkdirSync(pending, { recursive: true })
  const record = { v: 2, consent: "enabled", scope: { cwd: "/repo" }, uuid: "0b6c5d3e-2f1a-4c8b-9d7e-6a5b4c3d2e1f" }
  writeFileSync(join(pending, `${record.uuid}.json`), JSON.stringify(record))
  writeFileSync(join(summaryDir(stateDir), "hashed_old.json"), JSON.stringify({ v: 2, consent: "enabled", scope: { cwd: "/repo" } }))
}

const queuedFiles = (stateFiles: readonly string[]): readonly string[] =>
  stateFiles.filter((name) => name.startsWith("session-summary/") && name.endsWith(".json")).sort()

describe("telemetry turned off loads and writes nothing", () => {
  for (const [label, disable] of DISABLED) {
    test(`#given ${label} #when a session starts, runs two turns and quits #then the sidecar and the transport never load and the state dir stays empty`, async () => {
      await withAgentDir(async (agentDir) => {
        const run = await runSession(agentDir, disable(agentDir))

        expect({ sidecarLoaded: run.sidecarLoaded, transport: run.transport }).toEqual({ sidecarLoaded: false, transport: 0 })
        expect(run.stateFiles).toEqual([])
      })
    }, 60_000)
  }

  test("#given telemetry on and consented #when a session runs a turn #then the summary sidecar loads (the spy sees it)", async () => {
    await withAgentDir(async (agentDir) => {
      const run = await runSession(agentDir, { env: {}, configEnabled: true }, 1)

      expect(run.sidecarLoaded).toBe(true)
    })
  }, 60_000)

  test("#given a summary queue an opted-in run left #when the persisted setting is off and a session quits #then the queue is deleted without loading the sidecar", async () => {
    await withAgentDir(async (agentDir) => {
      seedQueue(join(agentDir, "omo-senpi", "omo-native"))

      const run = await runSession(agentDir, { env: {}, configEnabled: false })

      expect(run.sidecarLoaded).toBe(false)
      expect(queuedFiles(run.stateFiles)).toEqual([])
    })
  }, 60_000)

  test("#given a summary queue an opted-in run left #when a session opted out by environment variable quits #then that per-process opt-out leaves the queue and loads no sidecar", async () => {
    await withAgentDir(async (agentDir) => {
      seedQueue(join(agentDir, "omo-senpi", "omo-native"))

      const run = await runSession(agentDir, { env: { OMO_DISABLE_TELEMETRY: "1" }, configEnabled: true })

      expect(run.sidecarLoaded).toBe(false)
      expect(queuedFiles(run.stateFiles)).toEqual(["session-summary/hashed_old.json", "session-summary/pending/0b6c5d3e-2f1a-4c8b-9d7e-6a5b4c3d2e1f.json"])
    })
  }, 60_000)
})

