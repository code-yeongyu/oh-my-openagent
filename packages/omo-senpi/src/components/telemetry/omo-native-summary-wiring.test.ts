import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { describe, expect, test } from "bun:test"

import { createDefaultPostHogTransport, type TelemetryCaptureMessage, type TelemetryEnv, type TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createOmoNativeTelemetryComponent } from "./omo-native-component"
import { summaryDir } from "./session-summary-storage"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createRejectingTransportRecorder,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

// Ack contract at the real transport boundary: session_summary carries its window id as the PostHog event
// uuid, its pending file is deleted only after the transport's flush resolves, and a failed flush leaves it
// to be re-sent, under the same uuid, by the next registration that captures.

function turnEnd(): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 0,
    message: {
      role: "assistant", content: [], provider: "openai", model: "gpt-5.6-sol", stopReason: "stop", timestamp: 1,
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.0002 } },
    },
    toolResults: [],
  }
}

type SessionVariant = {
  readonly sessionId?: string
  readonly env?: TelemetryEnv
  readonly configEnabled?: boolean
}

async function runSession(agentDir: string, factory: TelemetryTransportFactory, withTurn: boolean, variant: SessionVariant = {}): Promise<void> {
  const pi = new FakeExtensionAPI()
  const sessionId = variant.sessionId ?? (withTurn ? "ack-session" : "later-session")
  const session = { cwd: "/repo", sessionManager: { getSessionId: () => sessionId } }
  createOmoNativeTelemetryComponent({
    rawTurnSampleRate: 0,
    env: { ...createEnabledEnv(agentDir), ...variant.env },
    hashSessionId: (raw) => `hashed:${raw}`,
    isConfigEnabled: () => variant.configEnabled ?? true,
    now: FIXED_NOW,
    osProvider: createOsProvider("ack-host"),
    stateDir: join(agentDir, "omo-senpi", "omo-native"),
    transportFactory: factory,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
  if (withTurn) await pi.dispatch("turn_end", turnEnd(), session)
  await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
}

const summaryDirOf = (agentDir: string) => summaryDir(join(agentDir, "omo-senpi", "omo-native"))

function pendingOf(agentDir: string): string[] {
  const dir = join(summaryDirOf(agentDir), "pending")
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : []
}

// Every file under the summary directory, at any depth: windows, pending events, owner registry, temps.
function queuedFilesOf(agentDir: string): string[] {
  const dir = summaryDirOf(agentDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => basename(name).includes("."))
}

const DEAD_OWNER = { pid: 2_147_483_000, bootId: "legacy-boot" }
const LEGACY_UUID = "0395eae0-1111-4222-8333-944455556666"

// A record exactly as the pre-fix version wrote it: no consent mark.
function writeLegacyQueue(agentDir: string): void {
  const dir = summaryDirOf(agentDir)
  mkdirSync(join(dir, "pending"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(dir, "pending", `${LEGACY_UUID}.json`), JSON.stringify({
    v: 2, uuid: LEGACY_UUID, sessionHash: "hashed:off-session", owner: DEAD_OWNER, createdAt: now,
    properties: { $session_id: "hashed:off-session", turns: 1, ended_by: "shutdown" },
  }))
}

// Delivers only what was enqueued; `capture` enqueues asynchronously, after this test is over, the way
// posthog-node prepares an event before queueing it. `captureImmediate` resolves once the event was sent.
function createLateEnqueueTransport(): { readonly sent: TelemetryCaptureMessage[]; readonly factory: TelemetryTransportFactory } {
  const sent: TelemetryCaptureMessage[] = []
  const queue: TelemetryCaptureMessage[] = []
  const never = new Promise<void>(() => undefined)
  return {
    sent,
    factory: () => ({
      capture(message) {
        void never.then(() => queue.push(message))
      },
      captureImmediate: async (message) => {
        sent.push(message)
      },
      flush: async () => {
        sent.push(...queue.splice(0))
      },
      shutdown: async () => undefined,
    }),
  }
}

const summariesOf = (messages: readonly TelemetryCaptureMessage[]) => messages.filter(({ event }) => event === "session_summary")

describe("session_summary acknowledgment through the native transport", () => {
  test("#given an acknowledging transport #when the session quits #then the summary carries a uuid and no pending file is left", async () => {
    await withTempAgentDir(async (agentDir) => {
      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, true)

      const summaries = summariesOf(recorder.messages)
      expect(summaries).toHaveLength(1)
      expect(summaries[0]?.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(summaries[0]?.properties).toMatchObject({ cost_1e4: 2, cost_usd: 0.0002, dropped_events: 0 })
      expect(pendingOf(agentDir)).toEqual([])
    })
  })

  test("#given a transport whose flush fails #when a later session captures #then the same uuid is sent again and then retired", async () => {
    await withTempAgentDir(async (agentDir) => {
      const failed: TelemetryCaptureMessage[] = []
      await runSession(agentDir, createRejectingTransportRecorder(failed), true)
      const firstUuid = summariesOf(failed)[0]?.uuid
      expect(firstUuid).toBeString()
      expect(pendingOf(agentDir)).toEqual([`${firstUuid}.json`])

      const pending: unknown = JSON.parse(readFileSync(join(summaryDirOf(agentDir), "pending", `${firstUuid}.json`), "utf8"))
      expect(pending).toMatchObject({ consent: "enabled" })

      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, false)
      const resent = summariesOf(recorder.messages)
      expect(resent.map(({ uuid }) => uuid)).toEqual([firstUuid])
      expect(pendingOf(agentDir)).toEqual([])

      // The re-send keeps the original event time, so PostHog's (uuid, day) dedup key stays the same.
      const createdAt = Reflect.get(pending as object, "createdAt")
      expect(summariesOf(failed)[0]?.timestamp?.getTime()).toBe(createdAt)
      expect(resent[0]?.timestamp?.getTime()).toBe(createdAt)
    })
  })

  test("#given a transport that enqueues a capture only later #when the session quits #then the summary is retired only after it was really sent", async () => {
    await withTempAgentDir(async (agentDir) => {
      const transport = createLateEnqueueTransport()
      await runSession(agentDir, transport.factory, true)

      const sentUuids = summariesOf(transport.sent).map(({ uuid }) => uuid)
      const retired = pendingOf(agentDir).length === 0
      expect({ sent: sentUuids.length, retired }).toEqual({ sent: 1, retired: true })
    })
  })
})

// The real PostHog transport against a fake HTTP server: only a 2xx answer retires the pending file.
describe("session_summary delivery through the real PostHog transport", () => {
  const realTransport = (host: string): TelemetryTransportFactory => (apiKey, options) =>
    createDefaultPostHogTransport(apiKey, { ...options, host, fetchRetryCount: 0 })

  const withServer = async (status: number, run: (host: string) => Promise<void>): Promise<void> => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("{}", { status }) })
    try {
      await run(server.url.origin)
    } finally {
      server.stop(true)
    }
  }

  test("#given a server answering 500 #when the session quits #then the pending file survives for a later retry", async () => {
    await withTempAgentDir(async (agentDir) => {
      await withServer(500, (host) => runSession(agentDir, realTransport(host), true))
      expect(pendingOf(agentDir)).toHaveLength(1)
    })
  })

  test("#given a refused connection #when the session quits #then the pending file survives for a later retry", async () => {
    await withTempAgentDir(async (agentDir) => {
      const closed = Bun.serve({ port: 0, fetch: () => new Response("{}") })
      const host = closed.url.origin
      closed.stop(true)
      await runSession(agentDir, realTransport(host), true)
      expect(pendingOf(agentDir)).toHaveLength(1)
    })
  })

  test("#given a server answering 200 #when the session quits #then the pending file is deleted", async () => {
    await withTempAgentDir(async (agentDir) => {
      await withServer(200, (host) => runSession(agentDir, realTransport(host), true))
      expect(pendingOf(agentDir)).toEqual([])
    })
  })
})

describe("session_summary consent", () => {
  test.each([
    ["DO_NOT_TRACK=1", { env: { DO_NOT_TRACK: "1" } }],
    ["OMO_DISABLE_POSTHOG=1", { env: { OMO_DISABLE_POSTHOG: "1" } }],
    ["OMO_SENPI_SEND_ANONYMOUS_TELEMETRY=0", { env: { OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" } }],
    ["telemetry off in config", { configEnabled: false }],
  ] as const)("#given an opted-out session (%s) and a later opted-in one #when both run #then nothing of the first is written or sent", async (_label, optOut) => {
    await withTempAgentDir(async (agentDir) => {
      const offMessages = createTransportRecorder()
      await runSession(agentDir, offMessages.factory, true, { sessionId: "off-session", ...optOut })
      expect(offMessages.messages).toEqual([])
      expect(queuedFilesOf(agentDir)).toEqual([])

      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, false)
      expect(summariesOf(recorder.messages)).toEqual([])
      expect(queuedFilesOf(agentDir)).toEqual([])
    })
  })

  test("#given a pending file written before consent marks existed #when an opted-in session starts #then it is purged unsent", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeLegacyQueue(agentDir)
      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, false)

      expect(summariesOf(recorder.messages)).toEqual([])
      expect(queuedFilesOf(agentDir)).toEqual([])
    })
  })

  test("#given a pending file written before consent marks existed #when an opted-out session runs #then it is purged too", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeLegacyQueue(agentDir)
      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, false, { env: { DO_NOT_TRACK: "1" } })

      expect(recorder.messages).toEqual([])
      expect(queuedFilesOf(agentDir)).toEqual([])
    })
  })
})

// Lead ruling (2026-10-20): an opt-out set by environment variable belongs to one process. It must not
// delete what another, consented session queued; only the persisted setting decides for everyone.
function writeConsentedQueue(agentDir: string): string[] {
  const dir = summaryDirOf(agentDir)
  mkdirSync(join(dir, "pending"), { recursive: true })
  const now = Date.now()
  const owner = { pid: process.pid, bootId: "consented-session-boot" }
  const uuid = "0395eae0-1111-4222-8333-944455556677"
  writeFileSync(join(dir, "pending", `${uuid}.json`), JSON.stringify({
    v: 2, consent: "enabled", scope: { cwd: "/repo" }, uuid, sessionHash: "hashed:consented", owner, createdAt: now,
    properties: { $session_id: "hashed:consented", turns: 1, ended_by: "shutdown" },
  }))
  writeFileSync(join(dir, "hashed_consented.json"), JSON.stringify({
    v: 2, consent: "enabled", scope: { cwd: "/repo" }, sessionHash: "hashed:consented", sessionRole: "root", owner,
    heartbeatAt: now, epoch: "0123456789abcdef", seq: 1, sampleRate: 0.05, windowId: null, window: null,
  }))
  return queuedFilesOf(agentDir).sort()
}

describe("a per-process opt-out leaves other sessions' queue alone", () => {
  for (const [label, env] of [
    ["OMO_DISABLE_TELEMETRY=1", { OMO_DISABLE_TELEMETRY: "1" }],
    ["DO_NOT_TRACK=1", { DO_NOT_TRACK: "1" }],
    ["OMO_SENPI_SEND_ANONYMOUS_TELEMETRY=0", { OMO_SENPI_SEND_ANONYMOUS_TELEMETRY: "0" }],
  ] as const) {
    test(`#given a consented session's window and pending event #when another session opted out by ${label} runs #then both survive`, async () => {
      await withTempAgentDir(async (agentDir) => {
        const before = writeConsentedQueue(agentDir)
        const recorder = createTransportRecorder()
        await runSession(agentDir, recorder.factory, false, { env })

        expect(recorder.messages).toEqual([])
        expect(queuedFilesOf(agentDir).sort()).toEqual(before)
      })
    })
  }

  test("#given a consented session's queue #when the persisted setting turns telemetry off for its project #then the queue is purged", async () => {
    await withTempAgentDir(async (agentDir) => {
      writeConsentedQueue(agentDir)
      const recorder = createTransportRecorder()
      await runSession(agentDir, recorder.factory, false, { configEnabled: false })

      expect(recorder.messages).toEqual([])
      expect(queuedFilesOf(agentDir)).toEqual([])
    })
  })
})

// Review LOW (8c6b1a8959): the persisted setting is read the way every process reads it, from the real config
// files, and never through this process's own profile selection.
describe("the purge reads the persisted setting from the real config files", () => {
  async function runRealConfigSession(agentDir: string, env: TelemetryEnv, cwd: string, accountHomeDir = agentDir): Promise<void> {
    const pi = new FakeExtensionAPI()
    const session = { cwd, sessionManager: { getSessionId: () => "real-config-session" } }
    createOmoNativeTelemetryComponent({
      rawTurnSampleRate: 0,
      env: { ...createEnabledEnv(agentDir), HOME: agentDir, ...env },
      hashSessionId: (raw) => `hashed:${raw}`,
      now: FIXED_NOW,
      osProvider: createOsProvider("real-config-host"),
      accountHomeDir,
      stateDir: join(agentDir, "omo-senpi", "omo-native"),
      transportFactory: createTransportRecorder().factory,
    }).register(pi, { config: pi, logger: createSilentLogger() })
    await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, session)
    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session)
  }

  function writeScopedPending(agentDir: string, uuid: string, cwd: string): void {
    const dir = join(summaryDirOf(agentDir), "pending")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${uuid}.json`), JSON.stringify({
      v: 2, consent: "enabled", scope: { cwd }, uuid, sessionHash: `hashed:${uuid}`, owner: { pid: process.pid, bootId: "other-session" }, createdAt: Date.now(),
      properties: { turns: 1 },
    }))
  }

  test("#given a project whose .omo/omo.json turns telemetry off #when any session quits #then that project's records go and another project's stay", async () => {
    await withTempAgentDir(async (agentDir) => {
      const offProject = join(agentDir, "off-project")
      const onProject = join(agentDir, "on-project")
      mkdirSync(join(offProject, ".omo"), { recursive: true })
      mkdirSync(onProject, { recursive: true })
      writeFileSync(join(offProject, ".omo", "omo.json"), JSON.stringify({ telemetry: { enabled: false } }))
      writeScopedPending(agentDir, "0395eae0-1111-4222-8333-944455556681", offProject)
      writeScopedPending(agentDir, "0395eae0-1111-4222-8333-944455556682", onProject)

      await runRealConfigSession(agentDir, { OMO_DISABLE_TELEMETRY: "1" }, onProject)

      expect(queuedFilesOf(agentDir).map((name) => basename(name))).toEqual(["0395eae0-1111-4222-8333-944455556682.json"])
    })
  })

  test("#given this process selects a profile that turns telemetry off #when it quits opted out #then other sessions' records survive", async () => {
    await withTempAgentDir(async (agentDir) => {
      const project = join(agentDir, "project")
      mkdirSync(join(agentDir, ".omo"), { recursive: true })
      mkdirSync(project, { recursive: true })
      writeFileSync(join(agentDir, ".omo", "omo.jsonc"), JSON.stringify({ profiles: { quiet: { telemetry: { enabled: false } } } }))
      writeScopedPending(agentDir, "0395eae0-1111-4222-8333-944455556683", project)

      await runRealConfigSession(agentDir, { OMO_PROFILE: "quiet" }, project)

      expect(queuedFilesOf(agentDir).map((name) => basename(name))).toEqual(["0395eae0-1111-4222-8333-944455556683.json"])
    })
  })

  test("#given this process points HOME at a config that turns telemetry off #when it quits opted out #then other sessions' records survive", async () => {
    await withTempAgentDir(async (agentDir) => {
      const project = join(agentDir, "project")
      const otherHome = join(agentDir, "other-home")
      mkdirSync(join(otherHome, ".omo"), { recursive: true })
      mkdirSync(project, { recursive: true })
      writeFileSync(join(otherHome, ".omo", "omo.jsonc"), JSON.stringify({ telemetry: { enabled: false } }))
      writeScopedPending(agentDir, "0395eae0-1111-4222-8333-944455556684", project)

      await runRealConfigSession(agentDir, { HOME: otherHome }, project, agentDir)

      expect(queuedFilesOf(agentDir).map((name) => basename(name))).toEqual(["0395eae0-1111-4222-8333-944455556684.json"])
    })
  })
})
