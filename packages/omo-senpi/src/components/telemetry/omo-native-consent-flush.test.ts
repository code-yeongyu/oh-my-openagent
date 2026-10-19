import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { describe, expect, test } from "bun:test"

import { createDefaultPostHogTransport } from "@oh-my-opencode/telemetry-core"
import type { TelemetryTransport, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { CONSENT_CACHE_MS, createOmoNativeTelemetryComponent } from "./omo-native-component"
import { FIXED_NOW, createEnabledEnv, createOsProvider, createSilentLogger, withTempAgentDir } from "./telemetry.test-support"

// #10226 delta-3 M1: consent was checked before an event entered the PostHog SDK queue, but nothing
// re-checked it when that queue was sent (the 10 s interval flush, the 20-event batch flush, the
// shutdown flush). These tests drive the REAL posthog-node transport against a local endpoint, so a
// POST that reaches the socket is exactly what would have reached the analytics host.

type Sink = {
  readonly url: string
  readonly posted: string[]
  readonly transports: TelemetryTransport[]
  isOpen(): boolean
}

async function withPostHogSink(run: (sink: Sink) => Promise<void>): Promise<void> {
  const posted: string[] = []
  const transports: TelemetryTransport[] = []
  let open = true
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const raw = new Uint8Array(await request.arrayBuffer())
      const text = new TextDecoder().decode(request.headers.get("content-encoding") === "gzip" ? gunzipSync(raw) : raw)
      const body: unknown = JSON.parse(text)
      const batch = isRecord(body) && Array.isArray(body.batch) ? body.batch : [body]
      for (const event of batch) posted.push(isRecord(event) && typeof event.event === "string" ? event.event : "<unnamed>")
      return Response.json({ status: 1 })
    },
  })
  try {
    await run({ url: `http://127.0.0.1:${server.port}`, posted, transports, isOpen: () => open })
  } finally {
    // A session a test leaves running, or an event it captures after the test, would flush into a
    // later test's fetch (#10394): close the queue to new events, then drain and stop every client.
    open = false
    await Promise.all(transports.map((transport) => transport.shutdown()))
    await server.stop(true)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function context(sessionId: string): Record<string, unknown> {
  return { cwd: "/repo", sessionManager: { getSessionId: () => sessionId } }
}

function turnEnd(): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex: 1,
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-sol",
      usage: {
        input: 11,
        output: 22,
        cacheRead: 3,
        cacheWrite: 4,
        reasoning: 5,
        totalTokens: 40,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.123456 },
      },
      stopReason: "stop",
      timestamp: 1,
    },
    toolResults: [],
  }
}

const native = (posted: readonly string[]): string[] => posted.filter((name) => name !== "omo_senpi_daily_active")

type DiagnosticRecord = { readonly event: string; readonly count: number | undefined }

type Harness = {
  readonly pi: FakeExtensionAPI
  readonly diagnostics: DiagnosticRecord[]
  /** The native SDK transport, so a test can run the same flush its 10 s timer would run. */
  readonly nativeTransport: () => TelemetryTransport
  setConsent(value: boolean): void
  /** The next flush the component runs fails before sending anything, leaving the queue intact. */
  failNextFlush(): void
}

function startSession(agentDir: string, sink: Sink): Harness {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: { models: [{ id: "gpt-5.6-sol" }] } } }))
  let consent = true
  let clock = 1_000_000
  let nativeTransport: TelemetryTransport | undefined
  let failingFlushes = 0
  const diagnostics: DiagnosticRecord[] = []
  const factory: TelemetryTransportFactory = (apiKey, options) => {
    // Only the native queue is under test. The legacy daily-active ping runs fire-and-forget and can
    // build its client after the test ended, so it gets an inert transport instead of a real one.
    if (options.flushAt !== 20) return { capture: () => undefined, flush: async () => undefined, shutdown: async () => undefined }
    const transport = createDefaultPostHogTransport(apiKey, options)
    sink.transports.push(transport)
    nativeTransport = transport
    return {
      capture: (message) => {
        if (sink.isOpen()) transport.capture(message)
      },
      shutdown: () => transport.shutdown(),
      flush: async () => {
        if (failingFlushes > 0) {
          failingFlushes -= 1
          throw new Error("flush failed before sending")
        }
        await transport.flush?.()
      },
    }
  }
  const pi = new FakeExtensionAPI()
  createOmoNativeTelemetryComponent({
    consentNow: () => clock,
    diagnostics: (input) => {
      diagnostics.push({ event: input.event, count: "count" in input ? input.count : undefined })
    },
    env: { ...createEnabledEnv(agentDir), POSTHOG_HOST: sink.url },
    hashSessionId: (raw) => `hashed:${raw}`,
    isConfigEnabled: () => consent,
    now: FIXED_NOW,
    osProvider: createOsProvider("consent-flush-host"),
    rawTurnSampleRate: 1,
    scheduleConsentCheck: () => () => undefined,
    stateDir: join(agentDir, "omo-senpi", "omo-native"),
    transportFactory: factory,
  }).register(pi, { config: pi, logger: createSilentLogger() })
  return {
    pi,
    diagnostics,
    nativeTransport: () => {
      if (nativeTransport === undefined) throw new Error("the session never built its native transport")
      return nativeTransport
    },
    setConsent(value) {
      consent = value
      clock += CONSENT_CACHE_MS + 1
    },
    failNextFlush() {
      failingFlushes += 1
    },
  }
}

async function flush(transport: TelemetryTransport): Promise<void> {
  if (transport.flush === undefined) throw new Error("the native transport cannot flush")
  await transport.flush()
}

describe("omo-native queued events after a consent withdrawal (#10226 M1)", () => {
  test("#given a consented session #when its queue is flushed and it shuts down #then the queued events are posted", async () => {
    await withPostHogSink(async (sink) => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const session = startSession(agentDir, sink)
        await session.pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("kept"))
        await session.pi.dispatch("turn_end", turnEnd(), context("kept"))
        expect(native(sink.posted)).toEqual([])

        // when
        await flush(session.nativeTransport())
        await session.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("kept"))

        // then
        expect(native(sink.posted)).toContain("session_started")
        expect(native(sink.posted)).toContain("turn_completed")
        expect(session.diagnostics.filter(({ event }) => event === "telemetry_events_dropped_by_consent")).toEqual([])
      })
    })
  })

  test("#given events queued while consented #when consent is withdrawn and the batch flush runs #then nothing is posted", async () => {
    await withPostHogSink(async (sink) => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const session = startSession(agentDir, sink)
        await session.pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("withdrawn"))
        await session.pi.dispatch("turn_end", turnEnd(), context("withdrawn"))
        expect(native(sink.posted)).toEqual([])

        // when: the opt-out lands, no event follows it, and the SDK's own flush comes around
        session.setConsent(false)
        await flush(session.nativeTransport())

        // then
        expect(native(sink.posted)).toEqual([])
      })
    })
  })

  test("#given events queued while consented #when consent is withdrawn and the session shuts down #then the shutdown flush posts nothing", async () => {
    await withPostHogSink(async (sink) => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const session = startSession(agentDir, sink)
        await session.pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("quit"))
        await session.pi.dispatch("turn_end", turnEnd(), context("quit"))

        // when
        session.setConsent(false)
        await session.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("quit"))

        // then
        expect(native(sink.posted)).toEqual([])
      })
    })
  })

  test("#given a withdrawal read mid-session #when consent comes back before the next flush #then the queue was already dropped and is never posted", async () => {
    await withPostHogSink(async (sink) => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const session = startSession(agentDir, sink)
        await session.pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("dropped"))
        await session.pi.dispatch("turn_end", turnEnd(), context("dropped"))

        // when: the next turn reads the opt-out, then the user opts back in before any flush
        session.setConsent(false)
        await session.pi.dispatch("turn_end", turnEnd(), context("dropped"))
        session.setConsent(true)
        await flush(session.nativeTransport())

        // then
        expect(native(sink.posted)).toEqual([])
        const dropped = session.diagnostics.filter(({ event }) => event === "telemetry_events_dropped_by_consent")
        expect(dropped.reduce((total, { count }) => total + (count ?? 0), 0)).toBeGreaterThanOrEqual(2)
        expect(JSON.stringify(dropped)).not.toContain("hashed:")
      })
    })
  })

  test("#given the drop flush at withdrawal fails #when consent comes back and a later flush runs #then the pre-withdrawal events are still not posted", async () => {
    await withPostHogSink(async (sink) => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const session = startSession(agentDir, sink)
        await session.pi.dispatch("session_start", { type: "session_start", reason: "startup" }, context("failed-drop"))
        await session.pi.dispatch("turn_end", turnEnd(), context("failed-drop"))
        session.failNextFlush()
        session.setConsent(false)
        await session.pi.dispatch("turn_end", turnEnd(), context("failed-drop"))

        // when
        session.setConsent(true)
        await flush(session.nativeTransport())
        await session.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, context("failed-drop"))

        // then
        expect(native(sink.posted)).not.toContain("session_started")
        expect(native(sink.posted)).not.toContain("turn_completed")
        const events = session.diagnostics.map(({ event }) => event)
        expect(events).toContain("telemetry_drop_flush_failed")
        expect(events).not.toContain("telemetry_shutdown_failed")
      })
    })
  })
})
