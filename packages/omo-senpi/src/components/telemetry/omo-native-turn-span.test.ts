import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { readTurnTraceparent, type TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"
import {
  createOtlpTelemetryTransport,
  inspectOtlpRequest,
  type InspectedLogRecord,
  type InspectedSpan,
  type OtlpTelemetryTransport,
  type OtlpWireProjection,
  type SpanAllowlist,
  type WireAttributes,
} from "@oh-my-opencode/telemetry-core/otlp"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { CONSENT_CACHE_MS, createOmoNativeTelemetryComponent } from "./omo-native-component"
import {
  FIXED_NOW,
  createEnabledEnv,
  createOsProvider,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

// The transport requires a schema artifact's projection; this mirrors telemetry-core's test stand-in
// (`$session_id` becomes `session.id`, every other primitive that passes the key rule `omo.<name>`), which is
// not exported to other packages.
const NON_WIRE_KEYS = new Set(["$os", "$os_version", "$process_person_profile", "$session_id", "ci", "event_id", "install_hash", "package_version", "platform", "product_name", "schema_version", "surface"])
// Every attribute omo-native-turn-span sets on `omo.turn`; the transport drops anything not listed.
const TURN_SPANS: SpanAllowlist = {
  "omo.turn": [
    "gen_ai.operation.name",
    "gen_ai.provider.name",
    "gen_ai.request.model",
    "gen_ai.response.model",
    "omo.model_id",
    "omo.provider",
    "omo.session.role",
    "omo.turn.end_reason",
    "omo.turn.index",
    "session.id",
  ],
}
// Sessions per test (a parent and its child at most); each takes its own transport from this pool.
const TRANSPORT_POOL = 4

const testProjection: OtlpWireProjection = (_event, properties) => {
  const attributes: WireAttributes = {}
  const session = properties["$session_id"]
  if (typeof session === "string" && session.length > 0) attributes["session.id"] = session
  for (const [key, value] of Object.entries(properties)) {
    if (NON_WIRE_KEYS.has(key) || key.startsWith("$")) continue
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      attributes[`omo.${key}`] = value
    }
  }
  return attributes
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

type Collector = {
  readonly factory: TelemetryTransportFactory
  readonly drain: () => Promise<{ readonly logs: InspectedLogRecord[]; readonly spans: InspectedSpan[] }>
}

// A real OTLP transport per factory call, sending to a recording endpoint. Its shutdown is deferred
// to `drain` so the test reads every record the session wrote, including the shutdown-time ones,
// unless `liveShutdown` lets the session's own shutdown really shut the transport down.
async function otlpCollector(options: { readonly liveShutdown?: boolean } = {}): Promise<Collector> {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-turn-span-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const bodies: { url: string; body: Uint8Array }[] = []
  const transports: OtlpTelemetryTransport[] = []
  const pool: OtlpTelemetryTransport[] = []
  for (let slot = 0; slot < TRANSPORT_POOL; slot += 1) {
    const transport = await createOtlpTelemetryTransport({
      productEnvPrefix: "OMO_TEST",
      ingestKey: "test-ingest-key",
      spoolDir: join(root, "telemetry-spool"),
      spoolRoot: root,
      resource: { "service.name": "omo-senpi", "service.version": "1.0.0" },
      scope: { name: "omo-senpi", version: "1.0.0" },
      project: testProjection,
      spans: TURN_SPANS,
      env: {},
      endpoint: "https://collector.test",
      autoStart: false,
      sleep: async () => undefined,
      random: () => 0,
      fetch: async (url, init) => {
        bodies.push({ url, body: init.body instanceof Uint8Array ? init.body : new Uint8Array() })
        return new Response(null, { status: 200 })
      },
    })
    if (transport === null) throw new Error("collector transport unexpectedly disabled")
    pool.push(transport)
  }
  const factory: TelemetryTransportFactory = () => {
    const transport = pool.shift()
    if (transport === undefined) throw new Error(`a test opened more than ${TRANSPORT_POOL} collector sessions`)
    transports.push(transport)
    return {
      capture: transport.capture,
      flush: transport.flush,
      traces: transport.traces,
      shutdown: options.liveShutdown === true ? transport.shutdown : async () => undefined,
    }
  }
  return {
    factory,
    async drain() {
      for (const transport of transports) await transport.shutdown()
      const logs: InspectedLogRecord[] = []
      const spans: InspectedSpan[] = []
      for (const { url, body } of bodies) {
        const inspected = await inspectOtlpRequest(url.endsWith("/v1/traces") ? "traces" : "logs", body)
        logs.push(...inspected.logs)
        spans.push(...inspected.spans)
      }
      return { logs, spans }
    },
  }
}

function eventContext(sessionId: string): Record<string, unknown> {
  return {
    cwd: "/repo",
    sessionManager: { getSessionId: () => sessionId },
    model: { provider: "openai", id: "gpt-5.6-sol" },
  }
}

function turnStart(turnIndex: number): Record<string, unknown> {
  return { type: "turn_start", turnIndex, timestamp: 1 }
}

function turnEnd(turnIndex: number, stopReason = "stop"): Record<string, unknown> {
  return {
    type: "turn_end",
    turnIndex,
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-sol",
      usage: { input: 11, output: 22, cacheRead: 3, cacheWrite: 4, reasoning: 5, totalTokens: 40, cost: { total: 0.12 } },
      stopReason,
      timestamp: 1,
    },
    toolResults: [],
  }
}

const featureToolResult = {
  type: "tool_result",
  toolCallId: "call-1",
  toolName: "create_goal",
  input: {},
  content: [],
  isError: false,
}

type Session = { readonly pi: FakeExtensionAPI; readonly ctx: Record<string, unknown> }
type Component = ReturnType<typeof createOmoNativeTelemetryComponent>

/**
 * A consent switch the component reads; `set` also moves the clock past the consent cache, while
 * `withdrawWithinCache` leaves the cached read stale, so only a fresh read can see the withdrawal.
 */
type Consent = {
  readonly isEnabled: () => boolean
  readonly now: () => number
  readonly set: (value: boolean) => void
  readonly withdrawWithinCache: () => void
}

function consentSwitch(): Consent {
  let value = true
  let clock = 1_000_000
  return {
    isEnabled: () => value,
    now: () => clock,
    set(next) {
      value = next
      clock += CONSENT_CACHE_MS + 1
    },
    withdrawWithinCache() {
      value = false
    },
  }
}

function processComponent(
  agentDir: string,
  transportFactory: TelemetryTransportFactory,
  env: Record<string, string> = {},
  consent: Consent = consentSwitch(),
): Component {
  return createOmoNativeTelemetryComponent({
    rawTurnSampleRate: 1,
    env: { ...createEnabledEnv(agentDir), ...env },
    hashSessionId: (raw) => `hashed:${raw}`,
    isConfigEnabled: consent.isEnabled,
    consentNow: consent.now,
    now: FIXED_NOW,
    osProvider: createOsProvider("turn-span-host"),
    stateDir: join(agentDir, "omo-senpi", "omo-native"),
    taskStateDir: join(agentDir, "tasks"),
    transportFactory,
  })
}

async function openSession(
  agentDir: string,
  transportFactory: TelemetryTransportFactory,
  sessionId: string,
  extra: {
    readonly env?: Record<string, string>
    readonly sessionContext?: Record<string, string>
    readonly component?: Component
    readonly consent?: Consent
  } = {},
): Promise<Session> {
  const pi = new FakeExtensionAPI()
  if (extra.sessionContext !== undefined) Object.assign(pi, { sessionContext: extra.sessionContext })
  const component = extra.component ?? processComponent(agentDir, transportFactory, extra.env, extra.consent)
  component.register(pi, { config: pi, logger: createSilentLogger() })
  const ctx = eventContext(sessionId)
  await pi.dispatch("session_start", { type: "session_start", reason: "startup" }, ctx)
  return { pi, ctx }
}

const turnRows = (logs: readonly InspectedLogRecord[]) => logs.filter(({ eventName }) => eventName === "omo.turn_completed")

describe("omo.turn span per assistant turn", () => {

  test("#given a turn on a model the collector pin does not list #then the span's model attributes leave as custom", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given: claude-fable-5-5 is in the client vocabulary but not in the pinned enum (required on the span)
      const collector = await otlpCollector()
      const { pi, ctx } = await openSession(agentDir, collector.factory, "main-unpinned")
      const unpinnedCtx = { ...ctx, model: { provider: "anthropic", id: "claude-fable-5-5" } }
      const end = turnEnd(0)
      const message = { ...(end.message as Record<string, unknown>), provider: "anthropic", model: "claude-fable-5-5" }

      // when
      await pi.dispatch("turn_start", turnStart(0), unpinnedCtx)
      await pi.dispatch("turn_end", { ...end, message }, unpinnedCtx)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, unpinnedCtx)
      const { spans } = await collector.drain()

      // then
      expect(spans).toHaveLength(1)
      expect(spans[0]?.attributes["omo.model_id"]).toBe("custom")
      expect(spans[0]?.attributes["gen_ai.request.model"]).toBe("custom")
      expect(spans[0]?.attributes["gen_ai.response.model"]).toBe("custom")
    })
  })
  test("#given a three-turn session on the collector sink #then three ok spans carry the D-P attributes, each turn_completed carries its own span's exact pair, and events outside a turn carry none", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const { pi, ctx } = await openSession(agentDir, collector.factory, "main-1")

      // when
      for (const index of [0, 1, 2]) {
        await pi.dispatch("turn_start", turnStart(index), ctx)
        if (index === 1) await pi.dispatch("tool_result", featureToolResult, ctx)
        await pi.dispatch("turn_end", turnEnd(index), ctx)
      }
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)
      const { logs, spans } = await collector.drain()

      // then
      expect(spans).toHaveLength(3)
      for (const [index, span] of spans.entries()) {
        expect(span).toMatchObject({ name: "omo.turn", kind: "internal", status: "ok", parentSpanId: undefined })
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
        expect(span.endTimeUnixNano >= span.startTimeUnixNano).toBe(true)
        expect(span.attributes).toEqual({
          "gen_ai.operation.name": "chat",
          "gen_ai.provider.name": "openai",
          "omo.provider": "openai",
          "omo.model_id": "gpt-5.6-sol",
          "gen_ai.request.model": "gpt-5.6-sol",
          "gen_ai.response.model": "gpt-5.6-sol",
          "session.id": "hashed:main-1",
          "omo.session.role": "root",
          "omo.turn.index": index,
        })
      }
      expect(turnRows(logs).map(({ traceId, spanId }) => ({ traceId, spanId })))
        .toEqual(spans.map(({ traceId, spanId }) => ({ traceId, spanId })))
      const feature = logs.find(({ eventName }) => eventName === "omo.feature_used")
      expect(feature).toMatchObject({ traceId: spans[1]?.traceId, spanId: spans[1]?.spanId })
      for (const name of ["omo.session_started", "omo.daily_active", "omo.session_summary"]) {
        const outside = logs.filter(({ eventName }) => eventName === name)
        expect(outside.length).toBeGreaterThan(0)
        for (const record of outside) expect([record.traceId, record.spanId]).toEqual([undefined, undefined])
      }
    })
  })

  test("#given a parent turn that delegates to a process child through the per-child env #then two turns, two spans, two exact pair matches and four trace-only pairs, and the child row carries the CHILD span id", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const parent = await openSession(agentDir, collector.factory, "parent-raw")
      await parent.pi.dispatch("turn_start", turnStart(0), parent.ctx)
      const delegating = readTurnTraceparent("parent-raw")
      if (delegating === undefined) throw new Error("the delegating turn published no traceparent")
      const child = await openSession(agentDir, collector.factory, "child-process", {
        env: { OMO_SENPI_TASK_RPC_CHILD: "1", OMO_SENPI_TASK_TRACEPARENT: delegating },
      })

      // when
      await child.pi.dispatch("turn_start", turnStart(0), child.ctx)
      await child.pi.dispatch("turn_end", turnEnd(0), child.ctx)
      await parent.pi.dispatch("turn_end", turnEnd(0), parent.ctx)
      for (const session of [child, parent]) {
        await session.pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, session.ctx)
      }
      const { logs, spans } = await collector.drain()

      // then
      const parentSpan = spans.find(({ attributes }) => attributes["session.id"] === "hashed:parent-raw")
      const childSpan = spans.find(({ attributes }) => attributes["session.id"] === "hashed:child-process")
      expect(spans).toHaveLength(2)
      expect(parentSpan?.parentSpanId).toBeUndefined()
      expect(childSpan).toMatchObject({ traceId: parentSpan?.traceId, parentSpanId: parentSpan?.spanId })
      expect(childSpan?.attributes["omo.session.role"]).toBe("child")
      const rows = turnRows(logs)
      const exactPairs = rows.flatMap((row) => spans.filter((span) => span.traceId === row.traceId && span.spanId === row.spanId))
      const traceOnly = rows.flatMap((row) => spans.filter((span) => span.traceId === row.traceId))
      expect(rows).toHaveLength(2)
      expect(exactPairs).toHaveLength(2)
      expect(traceOnly).toHaveLength(4)
      expect(rows.find(({ attributes }) => attributes["session.id"] === "hashed:child-process")?.spanId).toBe(childSpan?.spanId)
      expect(readTurnTraceparent("parent-raw")).toBeUndefined()
    })
  })

  test("#given sessions whose engine role is dag_child or member #then every span carries the pinned role child, never the raw engine name", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const sessions = await Promise.all([
        openSession(agentDir, collector.factory, "dag-raw", { sessionContext: { role: "dag_child" } }),
        openSession(agentDir, collector.factory, "member-raw", { sessionContext: { role: "member" } }),
      ])

      // when
      for (const { pi, ctx } of sessions) {
        await pi.dispatch("turn_start", turnStart(0), ctx)
        await pi.dispatch("turn_end", turnEnd(0), ctx)
        await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)
      }
      const { spans } = await collector.drain()

      // then
      expect(spans).toHaveLength(2)
      expect(spans.map(({ attributes }) => attributes["omo.session.role"])).toEqual(["child", "child"])
    })
  })

  test("#given a shared-host child whose session context carries the delegating traceparent #then its turn span is a child of the delegating span", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const delegating = "00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01"
      const child = await openSession(agentDir, collector.factory, "child-host", {
        sessionContext: { role: "child", task_id: "st_1", state_dir: "/s", traceparent: delegating },
      })

      // when
      await child.pi.dispatch("turn_start", turnStart(0), child.ctx)
      await child.pi.dispatch("turn_end", turnEnd(0), child.ctx)
      const { logs, spans } = await collector.drain()

      // then
      expect(spans).toHaveLength(1)
      expect(spans[0]).toMatchObject({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "b7ad6b7169203331" })
      expect(turnRows(logs).map(({ traceId, spanId }) => [traceId, spanId])).toEqual([[spans[0]?.traceId, spans[0]?.spanId]])
    })
  })

  test("#given two sessions of one shared extension with interleaved turns #then their spans never share an id and each turn row carries its own session's span", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const component = processComponent(agentDir, collector.factory)
      const a = await openSession(agentDir, collector.factory, "sibling-a", { component })
      const b = await openSession(agentDir, collector.factory, "sibling-b", { component })

      // when
      await a.pi.dispatch("turn_start", turnStart(3), a.ctx)
      await b.pi.dispatch("turn_start", turnStart(7), b.ctx)
      await a.pi.dispatch("turn_end", turnEnd(3), a.ctx)
      await b.pi.dispatch("turn_end", turnEnd(7), b.ctx)
      const { logs, spans } = await collector.drain()

      // then
      const spanOf = (turnIndex: number) => spans.find(({ attributes }) => attributes["omo.turn.index"] === turnIndex)
      expect(spans).toHaveLength(2)
      expect(spanOf(3)?.spanId).not.toBe(spanOf(7)?.spanId)
      const rows = turnRows(logs).toSorted((left, right) => Number(left.attributes["omo.turn_index"]) - Number(right.attributes["omo.turn_index"]))
      expect(rows.map(({ attributes, spanId }) => [attributes["omo.turn_index"], spanId])).toEqual([
        [3, spanOf(3)?.spanId],
        [7, spanOf(7)?.spanId],
      ])
    })
  })

  test("#given a turn that fails and a turn abandoned without a turn_end #then both spans end with status error and the failed turn's row still carries its pair", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const { pi, ctx } = await openSession(agentDir, collector.factory, "failing")

      // when
      await pi.dispatch("turn_start", turnStart(0), ctx)
      await pi.dispatch("turn_end", turnEnd(0, "error"), ctx)
      await pi.dispatch("turn_start", turnStart(1), ctx)
      await pi.dispatch("agent_end", { type: "agent_end", messages: [], aborted: true }, ctx)
      const { logs, spans } = await collector.drain()

      // then
      expect(spans.map(({ status, attributes }) => [attributes["omo.turn.index"], status])).toEqual([[0, "error"], [1, "error"]])
      expect(turnRows(logs).map(({ traceId, spanId }) => ({ traceId, spanId }))).toEqual([
        { traceId: spans[0]?.traceId, spanId: spans[0]?.spanId },
      ])
    })
  })

  test("#given a turn still open when the session shuts down and consent still holds #then its span is exported as error with end reason shutdown", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector({ liveShutdown: true })
      const { pi, ctx } = await openSession(agentDir, collector.factory, "quit-mid-turn")
      await pi.dispatch("turn_start", turnStart(0), ctx)
      await pi.dispatch("turn_end", turnEnd(0), ctx)
      await pi.dispatch("turn_start", turnStart(1), ctx)

      // when
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)
      const { spans } = await collector.drain()

      // then
      expect(spans.map(({ status, attributes }) => [attributes["omo.turn.index"], status, attributes["omo.turn.end_reason"]])).toEqual([
        [0, "ok", undefined],
        [1, "error", "shutdown"],
      ])
    })
  })

  test("#given a turn still open when the session shuts down after consent was withdrawn #then that span is dropped, never exported", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const consent = consentSwitch()
      const { pi, ctx } = await openSession(agentDir, collector.factory, "withdrawn-mid-turn", { consent })
      await pi.dispatch("turn_start", turnStart(0), ctx)

      // when
      consent.set(false)
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)
      const { spans } = await collector.drain()

      // then
      expect(spans).toEqual([])
    })
  })

  // Every path that ends (and so exports) a span reads consent fresh at that moment, not the cached read.
  const spanEndings: readonly {
    readonly name: string
    readonly finish: (session: Session) => Promise<void>
    readonly exported: readonly (readonly [number, string])[]
  }[] = [
    { name: "turn_end", finish: async ({ pi, ctx }) => { await pi.dispatch("turn_end", turnEnd(0), ctx) }, exported: [[0, "ok"]] },
    {
      name: "agent_end abandon",
      finish: async ({ pi, ctx }) => { await pi.dispatch("agent_end", { type: "agent_end", messages: [], aborted: true }, ctx) },
      exported: [[0, "error"]],
    },
    { name: "the next turn_start", finish: async ({ pi, ctx }) => { await pi.dispatch("turn_start", turnStart(1), ctx) }, exported: [[0, "error"]] },
  ]

  for (const ending of spanEndings) {
    test(`#given consent withdrawn mid-turn inside the consent cache window #when the turn ends by ${ending.name} #then no span is exported and no traceparent is left`, async () => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const collector = await otlpCollector()
        const consent = consentSwitch()
        const session = await openSession(agentDir, collector.factory, "withdrawn-ending", { consent })
        await session.pi.dispatch("turn_start", turnStart(0), session.ctx)
        expect(readTurnTraceparent("withdrawn-ending")).toBeDefined()

        // when
        consent.withdrawWithinCache()
        await ending.finish(session)
        const { spans } = await collector.drain()

        // then
        expect(spans).toEqual([])
        expect(readTurnTraceparent("withdrawn-ending")).toBeUndefined()
      })
    })

    test(`#given consent kept #when the turn ends by ${ending.name} #then its span is exported exactly once`, async () => {
      await withTempAgentDir(async (agentDir) => {
        // given
        const collector = await otlpCollector()
        const session = await openSession(agentDir, collector.factory, "kept-ending")
        await session.pi.dispatch("turn_start", turnStart(0), session.ctx)

        // when
        await ending.finish(session)
        const { spans } = await collector.drain()

        // then
        expect(spans.map(({ attributes, status }) => [attributes["omo.turn.index"], status])).toEqual(ending.exported.map((row) => [...row]))
      })
    })
  }

  test("#given a published turn traceparent #when the turn ends, or the next turn starts after an opt-out #then no traceparent is left for a later child launch", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const collector = await otlpCollector()
      const consent = consentSwitch()
      const { pi, ctx } = await openSession(agentDir, collector.factory, "stale-trace", { consent })
      await pi.dispatch("turn_start", turnStart(0), ctx)
      expect(readTurnTraceparent("stale-trace")).toBeDefined()

      // when: the turn ends
      await pi.dispatch("turn_end", turnEnd(0), ctx)

      // then
      expect(readTurnTraceparent("stale-trace")).toBeUndefined()

      // when: a turn opens, the user opts out mid-turn, and the next turn starts with no turn_end between
      await pi.dispatch("turn_start", turnStart(1), ctx)
      expect(readTurnTraceparent("stale-trace")).toBeDefined()
      consent.set(false)
      await pi.dispatch("turn_start", turnStart(2), ctx)

      // then
      expect(readTurnTraceparent("stale-trace")).toBeUndefined()
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx)
      await collector.drain()
    })
  })

  test("#given the PostHog sink #when turns run #then no span exists and turn events still flow", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const recorder = createTransportRecorder()
      const { pi, ctx } = await openSession(agentDir, recorder.factory, "posthog")

      // when
      await pi.dispatch("turn_start", turnStart(0), ctx)
      await pi.dispatch("turn_end", turnEnd(0), ctx)

      // then
      expect(recorder.messages.map(({ event }) => event)).toContain("turn_completed")
      expect(readTurnTraceparent("posthog")).toBeUndefined()
    })
  })
})
