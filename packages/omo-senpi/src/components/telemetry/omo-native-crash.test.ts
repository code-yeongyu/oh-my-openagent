import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import type { TelemetryCaptureMessage, TelemetryEnv, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { crashClaimDir } from "./process-crash-records"
import { createOmoNativeSessionComponent } from "./omo-native-session"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS, getOmoNativeStateDir } from "./product-identity"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  withTempAgentDir,
} from "./telemetry.test-support"

// oh-my-openagent#8931: a crash can only be reported by a LATER process, and exactly once.
const HOST_ENDPOINT = "0123456789abcdef"
const RECENT = new Date(FIXED_NOW.getTime() - 60_000).toISOString()

function writeRecords(agentDir: string, host: readonly string[], process: readonly string[]): void {
  const hostDir = join(agentDir, "rpc-host-daemon", HOST_ENDPOINT)
  mkdirSync(hostDir, { recursive: true })
  writeFileSync(join(hostDir, "crashes.jsonl"), host.map((line) => `${line}\n`).join(""))
  mkdirSync(join(agentDir, "process-crashes"), { recursive: true })
  writeFileSync(join(agentDir, "process-crashes", "crashes.jsonl"), process.map((line) => `${line}\n`).join(""))
}

const LEGACY_HOST_RECORD = JSON.stringify({ at: RECENT, signal: "SIGSEGV", uptimeMs: 3_061_000 })
const TUI_RECORD = JSON.stringify({
  at: RECENT,
  kind: "interactive",
  detection: "unclean_exit",
  uptimeMs: 420_000,
  bunVersion: "1.4.2",
  senpiVersion: "2026.9.27-2",
  productVersion: "5.0.1",
})

async function startProcess(agentDir: string, messages: TelemetryCaptureMessage[], env?: TelemetryEnv): Promise<void> {
  const pi = new FakeExtensionAPI()
  const factory: TelemetryTransportFactory = () => ({
    capture: (message) => messages.push(message),
    flush: async () => undefined,
    shutdown: async () => undefined,
  })
  createOmoNativeSessionComponent({
    env: env ?? createEnabledEnv(agentDir),
    hashSessionId: (raw) => `hashed:${raw}`,
    isConfigEnabled: () => true,
    now: FIXED_NOW,
    osProvider: createOsProvider("crash-host"),
    transportFactory: factory,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  await pi.dispatch(
    "session_start",
    { type: "session_start", reason: "startup" },
    { cwd: "/repo", sessionManager: { getSessionId: () => "s" } },
  )
}

const crashes = (messages: readonly TelemetryCaptureMessage[]) => messages.filter(({ event }) => event === "process_crashed")

describe("OmO Native process_crashed", () => {
  it("#given crash records present at boot #when two later processes start in turn #then each crash is reported exactly once", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeRecords(agentDir, [LEGACY_HOST_RECORD], [TUI_RECORD])
      const first: TelemetryCaptureMessage[] = []
      const second: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, first)
      await startProcess(agentDir, second)

      // then
      expect(crashes(first).map(({ properties }) => properties)).toEqual([
        expect.objectContaining({
          process_kind: "interactive",
          detection: "unclean_exit",
          signal: "unknown",
          uptime_ms: 420_000,
          uptime_bucket: "1_10m",
          crashed_bun_version: "1.4.2",
          crashed_engine_version: "2026.9.27-2",
          crashed_omo_version: "5.0.1",
          $os: "darwin",
          arch: "arm64",
        }),
        expect.objectContaining({
          process_kind: "rpc-host",
          detection: "supervisor",
          signal: "SIGSEGV",
          uptime_bucket: "10_60m",
          crashed_bun_version: "unknown",
        }),
      ])
      expect(crashes(second)).toEqual([])
    })
  })

  it("#given one crash #when four sessions start concurrently #then it is reported once in total", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeRecords(agentDir, [], [TUI_RECORD])
      const messages: TelemetryCaptureMessage[] = []

      // when
      await Promise.all([1, 2, 3, 4].map(() => startProcess(agentDir, messages)))

      // then
      expect(crashes(messages)).toHaveLength(1)
    })
  })

  it("#given an opted-out user #when a process starts #then nothing is sent and nothing is claimed", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeRecords(agentDir, [LEGACY_HOST_RECORD], [TUI_RECORD])
      const env = { ...createEnabledEnv(agentDir), DO_NOT_TRACK: "1" }
      const optedOut: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, optedOut, env)

      // then
      expect(optedOut).toEqual([])
      expect(existsSync(crashClaimDir(getOmoNativeStateDir(env)))).toBe(false)
    })
  })

  it("#given malformed and stale lines beside a valid one #when a process starts #then only the valid recent crash is reported", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const stale = JSON.stringify({ at: "2026-01-01T00:00:00.000Z", signal: "SIGBUS", uptimeMs: 5 })
      writeRecords(agentDir, ['{"at":"tru', stale, '{"at":"not a date","uptimeMs":1}'], ['{"uptimeMs":-1,"at":"2026-07-03T04:04:06.000Z"}', TUI_RECORD])
      const messages: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, messages)

      // then
      expect(crashes(messages).map(({ properties }) => properties?.process_kind)).toEqual(["interactive"])
    })
  })

  it("#given a record carrying extra fields #when it is reported #then only allowlisted crash properties ship", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const leaky = JSON.stringify({
        at: RECENT, code: 1, kind: "print", uptimeMs: 10, stack: "at /Users/someone/secret.ts:1", cwd: "/Users/someone",
        senpiVersion: "/Users/someone/not-a-version",
      })
      writeRecords(agentDir, [], [leaky])
      const messages: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, messages)

      // then
      const [crash] = crashes(messages)
      const allowed = new Set<string>([
        ...OMO_NATIVE_PROPERTY_ALLOWLISTS.process_crashed,
        "$process_person_profile", "install_id", "package_version", "platform", "product_name", "schema_version", "surface",
      ])
      expect(Object.keys(crash?.properties ?? {}).filter((key) => !allowed.has(key))).toEqual([])
      expect(crash?.properties).toMatchObject({ exit_code: 1, signal: "none", crashed_engine_version: "unknown" })
      expect(JSON.stringify(crash)).not.toContain("/Users/someone")
    })
  })
})
