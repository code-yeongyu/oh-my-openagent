import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import type { TelemetryCaptureMessage, TelemetryEnv, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
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
// The main Senpi entry stays type-only in omo-senpi source; values load through the lazy barrel.
const { daemonDirectoryName } = await loadSenpiBarrel()
const RECENT = new Date(FIXED_NOW.getTime() - 60_000).toISOString()

function writeRecords(agentDir: string, host: readonly string[], process: readonly string[]): void {
  const hostDir = join(agentDir, "rpc-host-daemon", HOST_ENDPOINT)
  mkdirSync(hostDir, { recursive: true })
  writeFileSync(join(hostDir, "crashes.jsonl"), host.map((line) => `${line}\n`).join(""))
  mkdirSync(join(agentDir, "process-crashes"), { recursive: true })
  writeFileSync(join(agentDir, "process-crashes", "crashes.jsonl"), process.map((line) => `${line}\n`).join(""))
}

const LEGACY_HOST_RECORD = JSON.stringify({ at: RECENT, signal: "SIGSEGV", uptimeMs: 3_061_000 })

/** An endpoint directory exactly as the engine names it (`daemonDirectoryName`, case-folded on win32) under `rpc-host-daemon/`. */
function writeEndpoint(
  agentDir: string,
  socket: string,
  lines: readonly string[],
  identity: "endpoint.json" | "settings.json" = "endpoint.json",
): string {
  const name = daemonDirectoryName(socket)
  const dir = join(agentDir, "rpc-host-daemon", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, identity), JSON.stringify({ layout: 2, socket, created_at: RECENT }))
  writeFileSync(join(dir, "crashes.jsonl"), lines.map((line) => `${line}\n`).join(""))
  return name
}
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

  it("#given the same crash line in a p shard, an i shard and the legacy endpoint #when two processes start in turn #then each is sent once, tagged by its host kind", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const shards = join(agentDir, "rpc", "shards")
      writeEndpoint(agentDir, join(shards, "p-0123456789abcdef.sock"), [LEGACY_HOST_RECORD])
      writeEndpoint(agentDir, join(shards, "i-fedcba9876543210.sock"), [LEGACY_HOST_RECORD])
      writeEndpoint(agentDir, join(agentDir, "rpc", "rpc.sock"), [LEGACY_HOST_RECORD])
      const first: TelemetryCaptureMessage[] = []
      const second: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, first)
      await startProcess(agentDir, second)

      // then
      expect(crashes(first).map(({ properties }) => properties?.shard_kind).sort()).toEqual(["i", "none", "p"])
      expect(crashes(first).every(({ properties }) => properties?.process_kind === "rpc-host")).toBe(true)
      expect(readdirSync(crashClaimDir(getOmoNativeStateDir(createEnabledEnv(agentDir))))).toHaveLength(3)
      expect(crashes(second)).toEqual([])
    })
  })

  it("#given endpoints named only by a pre-layout settings.json, by a foreign endpoint.json, or by nothing #when a process starts #then the kind comes from settings.json and is unknown otherwise", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      writeEndpoint(agentDir, join(agentDir, "rpc", "shards", "p-00000000000000aa.sock"), [LEGACY_HOST_RECORD], "settings.json")
      const copied = writeEndpoint(agentDir, join(agentDir, "rpc", "shards", "p-00000000000000bb.sock"), [TUI_RECORD])
      writeFileSync(
        join(agentDir, "rpc-host-daemon", copied, "endpoint.json"),
        JSON.stringify({ layout: 2, socket: join(agentDir, "rpc", "shards", "i-00000000000000cc.sock") }),
      )
      mkdirSync(join(agentDir, "rpc-host-daemon", HOST_ENDPOINT), { recursive: true })
      writeFileSync(join(agentDir, "rpc-host-daemon", HOST_ENDPOINT, "crashes.jsonl"), `${LEGACY_HOST_RECORD}\n`)
      const messages: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, messages)

      // then
      expect(crashes(messages).map(({ properties }) => `${properties?.process_kind}:${properties?.shard_kind}`).sort()).toEqual([
        "interactive:unknown",
        "rpc-host:p",
        "rpc-host:unknown",
      ])
    })
  })

  it("#given an endpoint directory the engine named from a socket behind a symlinked directory #when a process starts #then its kind is still trusted", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given - the engine hashes the socket's RESOLVED directory, so the name differs from the spelling's hash
      const { createHostDaemonPaths } = await loadSenpiBarrel()
      mkdirSync(join(agentDir, "real-shards"), { recursive: true })
      symlinkSync(join(agentDir, "real-shards"), join(agentDir, "linked-shards"))
      const socket = join(agentDir, "linked-shards", "p-0123456789abcdef.sock")
      const dir = createHostDaemonPaths({ agentDir, socket }).dir
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "endpoint.json"), JSON.stringify({ layout: 2, socket, created_at: RECENT }))
      writeFileSync(join(dir, "crashes.jsonl"), `${LEGACY_HOST_RECORD}\n`)
      const messages: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, messages)

      // then
      expect(crashes(messages).map(({ properties }) => properties?.shard_kind)).toEqual(["p"])
    })
  })

  it("#given a shard host crash #when it is reported #then the payload carries only the host kind, never the key, socket or session", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const socket = join(agentDir, "rpc", "shards", "p-0123456789abcdef.sock")
      const endpoint = writeEndpoint(agentDir, socket, [LEGACY_HOST_RECORD])
      const messages: TelemetryCaptureMessage[] = []

      // when
      await startProcess(agentDir, messages)

      // then
      const [crash] = crashes(messages)
      expect(Object.keys(crash?.properties ?? {}).sort()).toEqual([
        "$os", "$process_person_profile", "arch", "crashed_bun_version", "crashed_engine_version", "crashed_omo_version",
        "detection", "install_id", "package_version", "platform", "process_kind", "product_name", "schema_version",
        "shard_kind", "signal", "surface", "uptime_bucket", "uptime_ms",
      ])
      expect(crash?.properties?.shard_kind).toBe("p")
      const wire = JSON.stringify(crash)
      for (const secret of ["0123456789abcdef", endpoint, socket, "hashed:"]) expect(wire).not.toContain(secret)
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
